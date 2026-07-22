import privacyDocument from "../../PRIVACY.md?raw";
import {
  GROOVE_BPM_MAX,
  GROOVE_BPM_MIN,
  PET_SCALE_MAX,
  PET_SCALE_MIN,
  REACTION_INTENSITY_MAX,
  REACTION_INTENSITY_MIN,
  type AppSettings,
  type SoundMode
} from "../shared/settings";
import type { ExternalTarget, UpdateState } from "../shared/update-contracts";
import {
  DEFAULT_JIAO_KEY_CODES,
  describeKeyCode,
  keyCodeFromDomCode
} from "../shared/key-classifier";

type SettingsTab = "sound" | "pet" | "about";

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Settings renderer is missing ${selector}`);
  return element;
}

const tabButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-tab]")];
const tabPanels = [...document.querySelectorAll<HTMLElement>("[data-panel]")];
const modeInputs = [...document.querySelectorAll<HTMLInputElement>(
  'input[name="sound-mode"]'
)];
const grooveTempoRow = requireElement<HTMLElement>("#groove-tempo-row");
const grooveBpm = requireElement<HTMLInputElement>("#groove-bpm");
const grooveBpmValue = requireElement<HTMLOutputElement>("#groove-bpm-value");
const dogMelody = requireElement<HTMLInputElement>("#dog-melody");
const volume = requireElement<HTMLInputElement>("#volume");
const volumeValue = requireElement<HTMLOutputElement>("#volume-value");
const petScale = requireElement<HTMLInputElement>("#pet-scale");
const petScaleValue = requireElement<HTMLOutputElement>("#pet-scale-value");
const reactionIntensity = requireElement<HTMLInputElement>("#reaction-intensity");
const reactionIntensityValue = requireElement<HTMLOutputElement>(
  "#reaction-intensity-value"
);
const flipHorizontal = requireElement<HTMLInputElement>("#flip-horizontal");
const flipVertical = requireElement<HTMLInputElement>("#flip-vertical");
const alwaysOnTop = requireElement<HTMLInputElement>("#always-on-top");
const clickThrough = requireElement<HTMLInputElement>("#click-through");
const jiaoKeys = requireElement<HTMLElement>("#jiao-keys");
const keyCount = requireElement<HTMLElement>("#key-count");
const captureKey = requireElement<HTMLButtonElement>("#capture-key");
const restoreKeys = requireElement<HTMLButtonElement>("#restore-keys");
const captureState = requireElement<HTMLElement>("#capture-state");
const updateStatus = requireElement<HTMLElement>("#update-status");
const updateDetail = requireElement<HTMLElement>("#update-detail");
const updateAction = requireElement<HTMLButtonElement>("#update-action");
const documentDialog = requireElement<HTMLDialogElement>("#document-dialog");
const documentBody = requireElement<HTMLElement>("#document-body");
const closeDocument = requireElement<HTMLButtonElement>("#close-document");

let settings: AppSettings | null = null;
let updateState: UpdateState | null = null;
let capturing = false;
let saveSequence = 0;

petScale.min = String(PET_SCALE_MIN * 100);
petScale.max = String(PET_SCALE_MAX * 100);
reactionIntensity.min = String(REACTION_INTENSITY_MIN * 100);
reactionIntensity.max = String(REACTION_INTENSITY_MAX * 100);
grooveBpm.min = String(GROOVE_BPM_MIN);
grooveBpm.max = String(GROOVE_BPM_MAX);

function selectTab(tab: SettingsTab): void {
  for (const button of tabButtons) {
    const selected = button.dataset.tab === tab;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
  for (const panel of tabPanels) {
    const selected = panel.dataset.panel === tab;
    panel.hidden = !selected;
    panel.classList.toggle("is-active", selected);
  }
}

function render(): void {
  if (!settings) return;
  grooveBpm.value = String(settings.grooveBpm);
  grooveBpmValue.textContent = `${settings.grooveBpm} BPM`;
  dogMelody.checked = settings.playbackMode === "groove";
  grooveTempoRow.hidden = !dogMelody.checked;
  for (const input of modeInputs) input.checked = input.value === settings.soundMode;
  volume.value = String(Math.round(settings.volume * 100));
  volumeValue.textContent = `${volume.value}%`;
  petScale.value = String(Math.round(settings.scale * 100));
  petScaleValue.textContent = `${petScale.value}%`;
  reactionIntensity.value = String(Math.round(settings.reactionIntensity * 100));
  reactionIntensityValue.textContent = `${reactionIntensity.value}%`;
  flipHorizontal.checked = settings.flipHorizontal;
  flipVertical.checked = settings.flipVertical;
  alwaysOnTop.checked = settings.alwaysOnTop;
  clickThrough.checked = settings.clickThrough;
  renderKeys();
}

function renderKeys(): void {
  if (!settings) return;
  jiaoKeys.replaceChildren();
  keyCount.textContent = `${settings.jiaoKeyCodes.length} 个`;
  if (settings.jiaoKeyCodes.length === 0) {
    const empty = document.createElement("span");
    empty.className = "empty-keys";
    empty.textContent = "当前没有叫按键";
    jiaoKeys.append(empty);
    return;
  }
  for (const keyCode of settings.jiaoKeyCodes) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "keycap";
    button.title = `移除 ${describeKeyCode(keyCode)}`;
    const label = document.createElement("span");
    label.textContent = describeKeyCode(keyCode);
    const remove = document.createElement("span");
    remove.className = "remove-mark";
    remove.textContent = "×";
    remove.setAttribute("aria-hidden", "true");
    button.append(label, remove);
    button.addEventListener("click", () => {
      void persist({
        jiaoKeyCodes: settings!.jiaoKeyCodes.filter((item) => item !== keyCode)
      });
    });
    jiaoKeys.append(button);
  }
}

function renderUpdateState(): void {
  if (!updateState) return;
  updateStatus.textContent = updateState.message;
  updateDetail.textContent = updateState.availableVersion
    ? `当前 ${updateState.currentVersion} · 可用 ${updateState.availableVersion}`
    : `当前版本 ${updateState.currentVersion}`;
  updateAction.disabled = false;
  switch (updateState.phase) {
    case "disabled":
      updateAction.textContent = "查看发布页";
      updateAction.dataset.action = "releases";
      break;
    case "manual":
      updateAction.textContent = "打开下载页";
      updateAction.dataset.action = "check";
      break;
    case "checking":
      updateAction.textContent = "检查中";
      updateAction.dataset.action = "none";
      updateAction.disabled = true;
      break;
    case "available":
      updateAction.textContent = "下载更新";
      updateAction.dataset.action = "download";
      break;
    case "downloading":
      updateAction.textContent = updateState.percent === null
        ? "下载中"
        : `${Math.round(updateState.percent)}%`;
      updateAction.dataset.action = "none";
      updateAction.disabled = true;
      break;
    case "downloaded":
      updateAction.textContent = "重启安装";
      updateAction.dataset.action = "install";
      break;
    default:
      updateAction.textContent = "检查更新";
      updateAction.dataset.action = "check";
  }
}

async function persist(patch: Partial<AppSettings>): Promise<void> {
  if (!settings) return;
  const sequence = ++saveSequence;
  settings = { ...settings, ...patch };
  render();
  try {
    const saved = await window.dagou.updateSettings(patch);
    if (sequence === saveSequence) {
      settings = saved;
      render();
    }
  } catch (error: unknown) {
    console.error("Failed to save settings", error);
    if (sequence === saveSequence) {
      settings = await window.dagou.getSettings();
      render();
    }
  }
}

function setCapturing(value: boolean): void {
  capturing = value;
  captureKey.classList.toggle("is-capturing", value);
  captureKey.textContent = value ? "取消录入" : "添加按键";
  captureState.textContent = value ? "等待按键..." : "";
}

for (const button of tabButtons) {
  button.addEventListener("click", () => {
    selectTab(button.dataset.tab as SettingsTab);
  });
  button.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const index = tabButtons.indexOf(button);
    const offset = event.key === "ArrowRight" ? 1 : -1;
    const next = tabButtons[(index + offset + tabButtons.length) % tabButtons.length];
    selectTab(next.dataset.tab as SettingsTab);
    next.focus();
  });
}

grooveBpm.addEventListener("input", () => {
  grooveBpmValue.textContent = `${grooveBpm.value} BPM`;
});
grooveBpm.addEventListener("change", () => {
  void persist({ grooveBpm: Number(grooveBpm.value) });
});
dogMelody.addEventListener("change", () => {
  void persist({
    playbackMode: dogMelody.checked ? "groove" : "instant"
  });
});

for (const input of modeInputs) {
  input.addEventListener("change", () => {
    if (input.checked) void persist({ soundMode: input.value as SoundMode });
  });
}

volume.addEventListener("input", () => {
  volumeValue.textContent = `${volume.value}%`;
});
volume.addEventListener("change", () => {
  void persist({ volume: Number(volume.value) / 100, muted: false });
});
petScale.addEventListener("input", () => {
  petScaleValue.textContent = `${petScale.value}%`;
});
petScale.addEventListener("change", () => {
  void persist({ scale: Number(petScale.value) / 100 });
});
reactionIntensity.addEventListener("input", () => {
  reactionIntensityValue.textContent = `${reactionIntensity.value}%`;
});
reactionIntensity.addEventListener("change", () => {
  void persist({ reactionIntensity: Number(reactionIntensity.value) / 100 });
});
flipHorizontal.addEventListener("change", () => {
  void persist({ flipHorizontal: flipHorizontal.checked });
});
flipVertical.addEventListener("change", () => {
  void persist({ flipVertical: flipVertical.checked });
});
alwaysOnTop.addEventListener("change", () => {
  void persist({ alwaysOnTop: alwaysOnTop.checked });
});
clickThrough.addEventListener("change", () => {
  void persist({ clickThrough: clickThrough.checked });
});
captureKey.addEventListener("click", () => setCapturing(!capturing));
restoreKeys.addEventListener("click", () => {
  void persist({ jiaoKeyCodes: [...DEFAULT_JIAO_KEY_CODES] });
});

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-external]")) {
  button.addEventListener("click", () => {
    void window.dagou.openExternal(button.dataset.external as ExternalTarget);
  });
}

requireElement<HTMLButtonElement>("[data-document=privacy]").addEventListener(
  "click",
  () => {
    documentBody.textContent = privacyDocument;
    documentBody.scrollTop = 0;
    documentDialog.showModal();
  }
);

updateAction.addEventListener("click", async () => {
  const action = updateAction.dataset.action;
  if (action === "none") return;
  if (action === "releases") {
    await window.dagou.openExternal("releases");
    return;
  }
  if (action === "install") {
    window.dagou.installUpdate();
    return;
  }
  updateAction.disabled = true;
  try {
    updateState = action === "download"
      ? await window.dagou.downloadUpdate()
      : await window.dagou.checkForUpdates();
  } catch (error: unknown) {
    updateStatus.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    renderUpdateState();
  }
});

closeDocument.addEventListener("click", () => documentDialog.close());
documentDialog.addEventListener("click", (event) => {
  if (event.target === documentDialog) documentDialog.close();
});

window.addEventListener("keydown", (event) => {
  if (!capturing) return;
  event.preventDefault();
  event.stopPropagation();
  const keyCode = keyCodeFromDomCode(event.code);
  if (keyCode === null) {
    captureState.textContent = "这个按键暂不支持";
    return;
  }
  const next = new Set(settings?.jiaoKeyCodes ?? []);
  next.add(keyCode);
  setCapturing(false);
  void persist({ jiaoKeyCodes: [...next] });
});

window.dagou.onSettingsChanged((nextSettings) => {
  settings = nextSettings;
  render();
});

window.dagou.onUpdateStateChanged((nextState) => {
  updateState = nextState;
  renderUpdateState();
});

async function start(): Promise<void> {
  const [initialSettings, initialUpdateState] = await Promise.all([
    window.dagou.getSettings(),
    window.dagou.getUpdateState()
  ]);
  settings = initialSettings;
  updateState = initialUpdateState;
  render();
  renderUpdateState();
  selectTab("sound");
  document.documentElement.dataset.ready = "true";
  window.dagou.notifyReady();
}

void start().catch((error: unknown) => {
  window.dagou.notifyFailed(error instanceof Error ? error.message : String(error));
});
