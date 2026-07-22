import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  powerMonitor,
  screen,
  Tray
} from "electron";
import { writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AudioSampleName,
  DogInputEvent,
  PetMoveRequest,
  PetPoint
} from "../shared/contracts";
import { AUDIO_SAMPLE_NAMES, IPC_CHANNELS } from "../shared/contracts";
import {
  PET_WINDOW_BASE_SIZE,
  type AppSettings
} from "../shared/settings";
import { resolveKeyExpression } from "../shared/key-classifier";
import {
  constrainWindowPositionToWorkArea,
  resizeSquareFromAnchor,
  shouldIgnorePetMouseEvents,
  type HorizontalAnchor,
  type VerticalAnchor,
  type WindowRectangle
} from "../shared/window-geometry";
import { KeyboardHook } from "./keyboard-hook";
import { KeyboardLifecycle } from "./keyboard-lifecycle";
import { SettingsStore } from "./settings-store";

const EDGE_MARGIN = 22;
const POSITION_SAVE_DELAY_MS = 250;
const ALLOWED_AUDIO = new Set<AudioSampleName>(AUDIO_SAMPLE_NAMES);
const isSmokeTest = process.argv.includes("--smoke-test");
const smokeResultPath = process.env.DAGOU_SMOKE_RESULT;
const smokeUserDataPath = process.env.DAGOU_SMOKE_USER_DATA;

if (isSmokeTest) app.disableHardwareAcceleration();

let petWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let keyboardHook: KeyboardHook | null = null;
let keyboardLifecycle: KeyboardLifecycle | null = null;
let settingsStore: SettingsStore | null = null;
let settings: AppSettings;
let isQuitting = false;
let rendererReady = false;
let systemSuspended = false;
let muteShortcutLabel: string | null = null;
let clickThroughShortcutLabel: string | null = null;
let petMouseInteractive = false;
let positionSaveTimer: NodeJS.Timeout | null = null;
let smokeFinished = false;
let smokePetReady = false;
let smokeSettingsReady = false;

function writeSmokeResult(
  result: Record<string, unknown>,
  final = false
): void {
  if (!isSmokeTest || !smokeResultPath || smokeFinished) return;
  if (final) smokeFinished = true;
  writeFileSync(smokeResultPath, JSON.stringify(result), "utf8");
}

function finishSmokeTestIfReady(): void {
  if (!isSmokeTest || !smokePetReady || !smokeSettingsReady) return;
  writeSmokeResult(
    { rendererReady: true, settingsReady: true, audioReady: true },
    true
  );
  console.log("DAGOU_SMOKE_READY");
  setImmediate(() => {
    isQuitting = true;
    app.quit();
  });
}

if (isSmokeTest && smokeUserDataPath) {
  app.setPath("userData", smokeUserDataPath);
}
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

function assetDirectory(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "assets", "dagou")
    : join(app.getAppPath(), "assets", "dagou");
}

function brandingDirectory(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "assets", "branding")
    : join(app.getAppPath(), "assets", "branding");
}

function audioPath(name: AudioSampleName): string {
  return join(assetDirectory(), "sounds", `${name}.wav`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function parsePetPoint(value: unknown): PetPoint | null {
  if (
    !isRecord(value) ||
    typeof value.x !== "number" ||
    !Number.isFinite(value.x) ||
    Math.abs(value.x) > 2_147_483_647 ||
    typeof value.y !== "number" ||
    !Number.isFinite(value.y) ||
    Math.abs(value.y) > 2_147_483_647
  ) {
    return null;
  }
  return { x: value.x, y: value.y };
}

function parsePetMoveRequest(value: unknown): PetMoveRequest | null {
  if (!isRecord(value)) return null;
  const position = parsePetPoint(value.position);
  const pointer = parsePetPoint(value.pointer);
  if (!position || !pointer || !isRecord(value.dragRegion)) return null;
  const dragPosition = parsePetPoint(value.dragRegion);
  const { width, height } = value.dragRegion;
  if (
    !dragPosition ||
    typeof width !== "number" ||
    !Number.isFinite(width) ||
    width <= 0 ||
    typeof height !== "number" ||
    !Number.isFinite(height) ||
    height <= 0
  ) {
    return null;
  }
  return {
    position,
    pointer,
    dragRegion: { ...dragPosition, width, height }
  };
}

function clipDragRegionToWindow(
  region: WindowRectangle,
  windowWidth: number,
  windowHeight: number
): WindowRectangle | null {
  const unboundedRight = region.x + region.width;
  const unboundedBottom = region.y + region.height;
  if (!Number.isFinite(unboundedRight) || !Number.isFinite(unboundedBottom)) {
    return null;
  }
  const x = Math.max(0, region.x);
  const y = Math.max(0, region.y);
  const right = Math.min(windowWidth, unboundedRight);
  const bottom = Math.min(windowHeight, unboundedBottom);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

function petWindowSize(): number {
  return Math.round(PET_WINDOW_BASE_SIZE * settings.scale);
}

function defaultPosition(size: number): { x: number; y: number } {
  const area = screen.getPrimaryDisplay().workArea;
  return {
    x: area.x + area.width - size - EDGE_MARGIN,
    y: area.y + area.height - size - EDGE_MARGIN
  };
}

function savedPosition(size: number): { x: number; y: number } {
  if (settings.x === null || settings.y === null) {
    const area = screen.getPrimaryDisplay().workArea;
    return constrainWindowPositionToWorkArea(
      defaultPosition(size),
      { x: 0, y: 0, width: size, height: size },
      area
    );
  }
  const point = { x: settings.x, y: settings.y };
  const display = screen.getDisplayNearestPoint(point);
  return constrainWindowPositionToWorkArea(
    point,
    { x: 0, y: 0, width: size, height: size },
    display.workArea
  );
}

function sendInput(event: DogInputEvent): void {
  if (!petWindow || petWindow.isDestroyed()) return;
  petWindow.webContents.send(IPC_CHANNELS.input, event);
}

function broadcastSettings(): void {
  for (const window of [petWindow, settingsWindow]) {
    if (window && !window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.settingsChanged, settings);
    }
  }
}

function schedulePositionSave(): void {
  if (!petWindow || petWindow.isDestroyed() || !settingsStore) return;
  if (positionSaveTimer) clearTimeout(positionSaveTimer);
  positionSaveTimer = setTimeout(() => {
    if (!petWindow || petWindow.isDestroyed() || !settingsStore) return;
    const [x, y] = petWindow.getPosition();
    settings = settingsStore.update({ x, y });
  }, POSITION_SAVE_DELAY_MS);
}

function reassertPetWindowOnTop(): void {
  if (!petWindow || petWindow.isDestroyed()) return;
  if (!settings.alwaysOnTop) {
    petWindow.setAlwaysOnTop(false);
    return;
  }
  petWindow.setAlwaysOnTop(true, "screen-saver");
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  petWindow.moveTop();
}

function applyPetMousePolicy(): void {
  if (!petWindow || petWindow.isDestroyed()) return;
  petWindow.setIgnoreMouseEvents(
    shouldIgnorePetMouseEvents(settings.clickThrough, petMouseInteractive),
    { forward: true }
  );
}

function resetPetMouseInteraction(): void {
  petMouseInteractive = false;
  applyPetMousePolicy();
}

function applyWindowSettings(
  horizontalAnchor: HorizontalAnchor = "right",
  verticalAnchor: VerticalAnchor = "bottom"
): void {
  if (!petWindow || petWindow.isDestroyed()) return;
  reassertPetWindowOnTop();
  applyPetMousePolicy();
  const size = petWindowSize();
  const bounds = petWindow.getBounds();
  const display = screen.getDisplayNearestPoint({
    x: horizontalAnchor === "right"
      ? bounds.x + bounds.width - 1
      : bounds.x,
    y: verticalAnchor === "bottom"
      ? bounds.y + bounds.height - 1
      : bounds.y
  });
  const nextBounds = resizeSquareFromAnchor(
    bounds,
    size,
    display.workArea,
    horizontalAnchor,
    verticalAnchor
  );
  if (
    bounds.x !== nextBounds.x ||
    bounds.y !== nextBounds.y ||
    bounds.width !== nextBounds.width ||
    bounds.height !== nextBounds.height
  ) {
    petWindow.setBounds(nextBounds, true);
  }
}

function syncKeyboardHook(): void {
  if (!keyboardLifecycle) return;
  try {
    keyboardLifecycle.sync({
      listening: settings.listening,
      rendererReady,
      systemSuspended
    });
  } catch (error: unknown) {
    console.error("Failed to update the global keyboard hook", error);
  }
}

function shortcutLabel(
  label: string,
  registeredShortcut: string | null
): string {
  return registeredShortcut
    ? `${label} (${registeredShortcut})`
    : `${label} (快捷键被占用)`;
}

function updateSettings(patch: Partial<AppSettings>): AppSettings {
  if (!settingsStore) return settings;
  settings = settingsStore.update(patch);
  applyWindowSettings();
  if (!settings.listening) syncKeyboardHook();
  broadcastSettings();
  if (settings.listening) syncKeyboardHook();
  rebuildTrayMenu();
  return settings;
}

function resetPosition(): void {
  if (!petWindow || petWindow.isDestroyed() || !settingsStore) return;
  const position = defaultPosition(petWindowSize());
  petWindow.setPosition(position.x, position.y, true);
  settings = settingsStore.update(position);
  broadcastSettings();
}

function volumeMenu(): Electron.MenuItemConstructorOptions[] {
  return [0.25, 0.5, 0.75, 1].map((volume) => ({
    label: `${Math.round(volume * 100)}%`,
    type: "radio",
    checked: Math.abs(settings.volume - volume) < 0.01,
    click: () => updateSettings({ volume })
  }));
}

function scaleMenu(): Electron.MenuItemConstructorOptions[] {
  return [0.75, 1, 1.5, 2.5, 5].map((scale) => ({
    label: `${Math.round(scale * 100)}%`,
    type: "radio",
    checked: Math.abs(settings.scale - scale) < 0.01,
    click: () => updateSettings({ scale })
  }));
}

function rebuildTrayMenu(): void {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "打开设置...", click: showSettingsWindow },
      { type: "separator" },
      {
        label: "暂停监听",
        type: "checkbox",
        checked: !settings.listening,
        click: (item) => updateSettings({ listening: !item.checked })
      },
      {
        label: shortcutLabel("静音狗叫", muteShortcutLabel),
        type: "checkbox",
        checked: settings.muted,
        click: (item) => updateSettings({ muted: item.checked })
      },
      { label: "声音大小", submenu: volumeMenu() },
      { label: "桌宠大小", submenu: scaleMenu() },
      {
        label: "演奏方式",
        submenu: [
          {
            label: "节奏乐谱",
            type: "radio",
            checked: settings.playbackMode === "groove",
            click: () => updateSettings({ playbackMode: "groove" })
          },
          {
            label: "即时反馈",
            type: "radio",
            checked: settings.playbackMode === "instant",
            click: () => updateSettings({ playbackMode: "instant" })
          }
        ]
      },
      {
        label: "声音模式",
        submenu: [
          {
            label: "大 / 狗交替",
            type: "radio",
            checked: settings.soundMode === "alternate",
            click: () => updateSettings({ soundMode: "alternate" })
          },
          {
            label: "按下大，松开狗",
            type: "radio",
            checked: settings.soundMode === "da-gou",
            click: () => updateSettings({ soundMode: "da-gou" })
          }
        ]
      },
      { type: "separator" },
      {
        label: shortcutLabel("鼠标穿透", clickThroughShortcutLabel),
        type: "checkbox",
        checked: settings.clickThrough,
        click: (item) => updateSettings({ clickThrough: item.checked })
      },
      {
        label: "强制置顶",
        type: "checkbox",
        checked: settings.alwaysOnTop,
        click: (item) => updateSettings({ alwaysOnTop: item.checked })
      },
      { label: "回到右下角", click: resetPosition },
      { type: "separator" },
      {
        label: "退出",
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ])
  );
}

function createTray(): void {
  const icon = nativeImage
    .createFromPath(join(brandingDirectory(), "tray-icon.png"))
    .resize({ width: 32, height: 32, quality: "best" });
  tray = new Tray(icon);
  tray.setToolTip("大狗叫桌宠");
  rebuildTrayMenu();
  tray.on("click", showSettingsWindow);
}

function registerShortcuts(): void {
  muteShortcutLabel = registerFirstAvailableShortcut(
    [
      ["CommandOrControl+Alt+M", "Ctrl+Alt+M"],
      ["CommandOrControl+Alt+Shift+M", "Ctrl+Alt+Shift+M"]
    ],
    () => updateSettings({ muted: !settings.muted })
  );
  clickThroughShortcutLabel = registerFirstAvailableShortcut(
    [
      ["CommandOrControl+Alt+D", "Ctrl+Alt+D"],
      ["CommandOrControl+Alt+Shift+D", "Ctrl+Alt+Shift+D"]
    ],
    () => updateSettings({ clickThrough: !settings.clickThrough })
  );
  if (!muteShortcutLabel) {
    console.warn("No mute shortcut is available; use the tray instead");
  }
  if (!clickThroughShortcutLabel) {
    console.warn("No click-through shortcut is available; use the tray instead");
  }
}

function registerFirstAvailableShortcut(
  candidates: ReadonlyArray<readonly [accelerator: string, label: string]>,
  action: () => void
): string | null {
  for (const [accelerator, label] of candidates) {
    if (globalShortcut.register(accelerator, action)) return label;
  }
  return null;
}

function createPetWindow(): BrowserWindow {
  petMouseInteractive = false;
  const size = petWindowSize();
  const position = savedPosition(size);
  const window = new BrowserWindow({
    width: size,
    height: size,
    x: position.x,
    y: position.y,
    frame: false,
    transparent: true,
    alwaysOnTop: settings.alwaysOnTop,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    fullscreenable: false,
    focusable: false,
    show: false,
    icon: join(brandingDirectory(), "tray-icon.png"),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      autoplayPolicy: "no-user-gesture-required"
    }
  });

  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.setIgnoreMouseEvents(true, { forward: true });
  window.on("move", schedulePositionSave);
  window.on("show", reassertPetWindowOnTop);
  window.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    window.hide();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("did-start-loading", () => {
    rendererReady = false;
    resetPetMouseInteraction();
    syncKeyboardHook();
  });
  window.webContents.on("render-process-gone", () => {
    rendererReady = false;
    resetPetMouseInteraction();
    syncKeyboardHook();
  });
  if (isSmokeTest) {
    window.webContents.on("console-message", (_event, _level, message) => {
      console.error(`DAGOU_RENDERER: ${message}`);
    });
    window.webContents.on("did-fail-load", (_event, code, description) => {
      console.error(`DAGOU_LOAD_FAILED: ${code} ${description}`);
      writeSmokeResult({ stage: "load-failed", code, error: description });
    });
    window.webContents.on("dom-ready", () => {
      writeSmokeResult({ stage: "dom-ready" });
    });
    window.webContents.on("did-finish-load", () => {
      writeSmokeResult({ stage: "did-finish-load" });
    });
  }
  window.once("ready-to-show", () => {
    if (!isSmokeTest) window.showInactive();
    applyWindowSettings();
    broadcastSettings();
  });
  void window.loadFile(
    join(app.getAppPath(), "dist", "index.html"),
    isSmokeTest ? { query: { "smoke-test": "1" } } : undefined
  );
  return window;
}

function showSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 560,
    height: 760,
    minWidth: 520,
    minHeight: 680,
    title: "大狗叫设置",
    backgroundColor: "#f4f5f2",
    autoHideMenuBar: true,
    show: false,
    icon: join(brandingDirectory(), "tray-icon.png"),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  settingsWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  settingsWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  if (isSmokeTest) {
    settingsWindow.webContents.on("console-message", (_event, _level, message) => {
      console.error(`DAGOU_SETTINGS_RENDERER: ${message}`);
    });
    settingsWindow.webContents.on("did-fail-load", (_event, code, description) => {
      console.error(`DAGOU_SETTINGS_LOAD_FAILED: ${code} ${description}`);
      writeSmokeResult({ stage: "settings-load-failed", code, error: description });
    });
    settingsWindow.webContents.on("did-finish-load", () => {
      writeSmokeResult({ stage: "settings-did-finish-load" });
    });
  }
  settingsWindow.once("ready-to-show", () => {
    if (!isSmokeTest) settingsWindow?.show();
    broadcastSettings();
  });
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
  void settingsWindow.loadFile(join(app.getAppPath(), "dist", "settings.html"));
}

function registerIpc(): void {
  ipcMain.handle(IPC_CHANNELS.getSettings, () => settings);
  ipcMain.handle(IPC_CHANNELS.updateSettings, (event, patch: unknown) => {
    const senderIsTrusted =
      event.sender === petWindow?.webContents ||
      event.sender === settingsWindow?.webContents;
    if (!senderIsTrusted || patch === null || typeof patch !== "object") {
      throw new Error("Invalid settings update");
    }
    return updateSettings(patch as Partial<AppSettings>);
  });
  ipcMain.handle(IPC_CHANNELS.resizePet, (event, requestedScale: unknown) => {
    if (
      event.sender !== petWindow?.webContents ||
      typeof requestedScale !== "number" ||
      !Number.isFinite(requestedScale) ||
      !settingsStore
    ) {
      throw new Error("Invalid pet resize request");
    }
    settings = settingsStore.update({ scale: requestedScale });
    applyWindowSettings(
      settings.flipHorizontal ? "right" : "left",
      settings.flipVertical ? "bottom" : "top"
    );
    broadcastSettings();
    rebuildTrayMenu();
    return settings;
  });
  ipcMain.on(IPC_CHANNELS.movePet, (event, payload: unknown) => {
    const window = petWindow;
    if (
      !window ||
      window.isDestroyed() ||
      event.sender !== window.webContents
    ) {
      return;
    }
    const request = parsePetMoveRequest(payload);
    if (!request) return;
    const contentBounds = window.getContentBounds();
    const dragRegion = clipDragRegionToWindow(
      request.dragRegion,
      contentBounds.width,
      contentBounds.height
    );
    if (!dragRegion) return;
    const display = screen.getDisplayNearestPoint({
      x: Math.round(request.pointer.x),
      y: Math.round(request.pointer.y)
    });
    const position = constrainWindowPositionToWorkArea(
      request.position,
      dragRegion,
      display.workArea
    );
    window.setPosition(position.x, position.y, false);
  });
  ipcMain.on(
    IPC_CHANNELS.setPetMouseInteractive,
    (event, interactive: unknown) => {
      if (
        event.sender !== petWindow?.webContents ||
        typeof interactive !== "boolean"
      ) {
        return;
      }
      if (petMouseInteractive === interactive) return;
      petMouseInteractive = interactive;
      applyPetMousePolicy();
    }
  );
  ipcMain.on(IPC_CHANNELS.rendererReady, (event) => {
    if (event.sender === settingsWindow?.webContents) {
      if (isSmokeTest) {
        smokeSettingsReady = true;
        finishSmokeTestIfReady();
      }
      return;
    }
    if (!petWindow || event.sender !== petWindow.webContents) return;
    broadcastSettings();
    rendererReady = true;
    if (isSmokeTest) {
      smokePetReady = true;
      finishSmokeTestIfReady();
      return;
    }
    syncKeyboardHook();
  });
  ipcMain.on(IPC_CHANNELS.rendererFailed, (event, message: unknown) => {
    const senderIsRenderer =
      event.sender === petWindow?.webContents ||
      event.sender === settingsWindow?.webContents;
    if (!senderIsRenderer) return;
    const error = typeof message === "string" ? message : "Unknown renderer error";
    console.error(`Renderer initialization failed: ${error}`);
    if (isSmokeTest) {
      writeSmokeResult(
        { rendererReady: false, audioReady: false, error },
        true
      );
      setImmediate(() => {
        isQuitting = true;
        app.quit();
      });
    }
  });
  ipcMain.handle(
    IPC_CHANNELS.loadAudio,
    async (_event, requestedName: unknown) => {
      if (
        typeof requestedName !== "string" ||
        !ALLOWED_AUDIO.has(requestedName as AudioSampleName)
      ) {
        throw new Error("Unsupported audio asset");
      }
      return readFile(audioPath(requestedName as AudioSampleName));
    }
  );
}

function handleSystemSuspend(): void {
  systemSuspended = true;
  syncKeyboardHook();
}

function handleSystemResume(): void {
  systemSuspended = false;
  syncKeyboardHook();
  setImmediate(reassertPetWindowOnTop);
}

function handleDisplayChange(): void {
  applyWindowSettings();
}

function registerPowerEvents(): void {
  powerMonitor.on("suspend", handleSystemSuspend);
  powerMonitor.on("resume", handleSystemResume);
  screen.on("display-added", handleDisplayChange);
  screen.on("display-removed", handleDisplayChange);
  screen.on("display-metrics-changed", handleDisplayChange);
}

async function startApplication(): Promise<void> {
  writeSmokeResult({ stage: "main-ready" });
  settingsStore = new SettingsStore(app.getPath("userData"));
  settings = settingsStore.get();
  registerIpc();
  petWindow = createPetWindow();
  writeSmokeResult({ stage: "window-created" });
  if (isSmokeTest) {
    showSettingsWindow();
    return;
  }
  keyboardHook = new KeyboardHook(sendInput, (keyCode) =>
    resolveKeyExpression(
      keyCode,
      settings.jiaoKeyCodes,
      settings.melodyEnabled
    )
  );
  keyboardLifecycle = new KeyboardLifecycle(keyboardHook);
  syncKeyboardHook();
  registerShortcuts();
  createTray();
  registerPowerEvents();
}

app.whenReady().then(startApplication).catch((error: unknown) => {
  console.error("Failed to start Dagou Desktop Pet", error);
  app.quit();
});

app.on("second-instance", () => {
  petWindow?.showInactive();
  setImmediate(reassertPetWindowOnTop);
});

app.on("before-quit", () => {
  isQuitting = true;
  if (positionSaveTimer) clearTimeout(positionSaveTimer);
  try {
    keyboardLifecycle?.dispose();
  } catch (error: unknown) {
    console.error("Failed to stop the global keyboard hook", error);
  }
  try {
    keyboardHook?.dispose();
  } catch (error: unknown) {
    console.error("Failed to dispose the global keyboard hook", error);
  }
  powerMonitor.removeListener("suspend", handleSystemSuspend);
  powerMonitor.removeListener("resume", handleSystemResume);
  screen.removeListener("display-added", handleDisplayChange);
  screen.removeListener("display-removed", handleDisplayChange);
  screen.removeListener("display-metrics-changed", handleDisplayChange);
  globalShortcut.unregisterAll();
  tray?.destroy();
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.destroy();
});

app.on("window-all-closed", () => {
  // The tray owns the app lifetime on Windows.
});
