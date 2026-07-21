import "./styles.css";
import idleDogUrl from "../../assets/dagou/sprites/idle.png?url";
import idleScaleDogUrl from "../../assets/dagou/sprites/idle-scale.png?url";
import shyDogUrl from "../../assets/dagou/sprites/idle-shy.png?url";
import shyTailDogUrl from "../../assets/dagou/sprites/idle-shy-tail.png?url";
import bark01DogUrl from "../../assets/dagou/sprites/bark01.png?url";
import bark02DogUrl from "../../assets/dagou/sprites/bark02.png?url";
import {
  AUDIO_SAMPLE_NAMES,
  type DogInputEvent
} from "../shared/contracts";
import type { AppSettings } from "../shared/settings";
import {
  scaleFromResizePointer
} from "../shared/window-geometry";
import { AudioEngine } from "./audio-engine";
import { DogAnimator } from "./dog-animation";
import { SoundController } from "./sound-controller";

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Dagou renderer is missing ${selector}`);
  }
  return element;
}

const stage = requireElement<HTMLElement>("#stage");
const dog = requireElement<HTMLElement>("#dog");
const jelly = requireElement<HTMLElement>("#dog-jelly");
const idleImage = requireElement<HTMLImageElement>("#dog-idle");
const shyImage = requireElement<HTMLImageElement>("#dog-shy");
const shyTailImage = requireElement<HTMLImageElement>("#dog-shy-tail");
const bark01Image = requireElement<HTMLImageElement>("#dog-bark01");
const bark02Image = requireElement<HTMLImageElement>("#dog-bark02");
const jiaoTint = requireElement<HTMLElement>("#dog-jiao-tint");
const idleScaleImage = requireElement<HTMLImageElement>("#dog-idle-scale");
const dogHitbox = requireElement<HTMLElement>("#dog-hitbox");
const scaleHandle = requireElement<HTMLElement>("#scale-handle");

idleImage.src = idleDogUrl;
shyImage.src = shyDogUrl;
shyTailImage.src = shyTailDogUrl;
bark01Image.src = bark01DogUrl;
bark02Image.src = bark02DogUrl;
jiaoTint.style.setProperty("--jiao-idle-mask", `url("${idleDogUrl}")`);
jiaoTint.style.setProperty("--jiao-scale-mask", `url("${idleScaleDogUrl}")`);
jiaoTint.style.setProperty("--jiao-shy-mask", `url("${shyDogUrl}")`);
jiaoTint.style.setProperty("--jiao-bark01-mask", `url("${bark01DogUrl}")`);
jiaoTint.style.setProperty("--jiao-bark02-mask", `url("${bark02DogUrl}")`);
idleScaleImage.src = idleScaleDogUrl;

const audio = new AudioEngine();
const sound = new SoundController(audio);
const animator = new DogAnimator(dog, jelly);
let settings: AppSettings | null = null;
let resizeGesture: {
  pointerId: number;
  startScreenX: number;
  startScreenY: number;
  startSize: number;
  flipHorizontal: boolean;
  flipVertical: boolean;
} | null = null;
let pendingResizeScale: number | null = null;
let resizeFrameId: number | null = null;

function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error("Audio initialization timed out")),
      milliseconds
    );
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function applySettings(nextSettings: AppSettings): void {
  settings = nextSettings;
  audio.setVolume(nextSettings.volume);
  audio.setMuted(nextSettings.muted);
  sound.configure(nextSettings);
  animator.setReactionIntensity(nextSettings.reactionIntensity);
  dog.classList.toggle("is-flipped-horizontal", nextSettings.flipHorizontal);
  dog.classList.toggle("is-flipped-vertical", nextSettings.flipVertical);
  stage.classList.toggle("is-muted", nextSettings.muted);
  stage.classList.toggle("is-paused", !nextSettings.listening);
  stage.classList.toggle("is-click-through", nextSettings.clickThrough);
  if (!nextSettings.listening) {
    animator.reset();
    sound.reset();
  }
}

function setScaleHover(value: boolean): void {
  dog.classList.toggle("is-scale-hover", value);
}

function sendPendingResize(): void {
  if (resizeFrameId !== null) cancelAnimationFrame(resizeFrameId);
  resizeFrameId = null;
  if (pendingResizeScale === null) return;
  const scale = pendingResizeScale;
  pendingResizeScale = null;
  void window.dagou.resizePet(scale).catch((error: unknown) => {
    console.error("Failed to resize Dagou window", error);
  });
}

function queueResize(scale: number): void {
  pendingResizeScale = scale;
  if (resizeFrameId !== null) return;
  resizeFrameId = requestAnimationFrame(sendPendingResize);
}

function finishResize(event: PointerEvent): void {
  if (!resizeGesture || event.pointerId !== resizeGesture.pointerId) return;
  sendPendingResize();
  if (scaleHandle.hasPointerCapture(event.pointerId)) {
    scaleHandle.releasePointerCapture(event.pointerId);
  }
  resizeGesture = null;
  stage.classList.remove("is-resizing");
  setScaleHover(scaleHandle.matches(":hover"));
}

dogHitbox.addEventListener("pointerenter", () => animator.showShy());
dogHitbox.addEventListener("click", (event) => {
  if (event.button !== 0 || settings?.clickThrough) return;
  event.preventDefault();
  event.stopPropagation();
  animator.pet();
});

scaleHandle.addEventListener("pointerenter", () => {
  animator.wakeFromShy();
  setScaleHover(true);
});
scaleHandle.addEventListener("pointerleave", () => {
  if (!resizeGesture) setScaleHover(false);
});
scaleHandle.addEventListener("pointerdown", (event) => {
  if (!settings || settings.clickThrough) return;
  event.preventDefault();
  event.stopPropagation();
  resizeGesture = {
    pointerId: event.pointerId,
    startScreenX: event.screenX,
    startScreenY: event.screenY,
    startSize: window.innerWidth,
    flipHorizontal: settings.flipHorizontal,
    flipVertical: settings.flipVertical
  };
  scaleHandle.setPointerCapture(event.pointerId);
  stage.classList.add("is-resizing");
  setScaleHover(true);
});
scaleHandle.addEventListener("pointermove", (event) => {
  if (!resizeGesture || event.pointerId !== resizeGesture.pointerId) return;
  queueResize(scaleFromResizePointer({
    startSize: resizeGesture.startSize,
    deltaX: event.screenX - resizeGesture.startScreenX,
    deltaY: event.screenY - resizeGesture.startScreenY,
    flipHorizontal: resizeGesture.flipHorizontal,
    flipVertical: resizeGesture.flipVertical
  }));
});
scaleHandle.addEventListener("pointerup", finishResize);
scaleHandle.addEventListener("pointercancel", finishResize);

function handleInput(event: DogInputEvent): void {
  if (event.type === "reset") {
    animator.reset();
    sound.reset();
    return;
  }
  animator.handleKey(event);
  if (!settings?.listening) return;
  sound.handle(event);
  if (event.phase === "down") {
    animator.trigger(event.role);
  } else if (event.role === "normal" && settings.soundMode === "da-gou") {
    animator.trigger("normal");
  }
}

async function start(): Promise<void> {
  let receivedSettingsUpdate = false;
  window.dagou.onSettingsChanged((nextSettings) => {
    receivedSettingsUpdate = true;
    applySettings(nextSettings);
  });
  window.dagou.onInput(handleInput);

  const initialSettingsPromise = window.dagou.getSettings();
  const isSmokeTest = new URLSearchParams(window.location.search).has("smoke-test");
  if (isSmokeTest) {
    const initialSettings = await initialSettingsPromise;
    if (!receivedSettingsUpdate) applySettings(initialSettings);
    const decoder = new OfflineAudioContext(1, 1, 32_000);
    await withTimeout(
      Promise.all(
        AUDIO_SAMPLE_NAMES.map(async (name) => {
          const bytes = await window.dagou.loadAudio(name);
          const decoded = await decoder.decodeAudioData(bytes.slice(0));
          if (decoded.length === 0) throw new Error(`${name} decoded empty`);
        })
      ),
      12_000
    );
    document.documentElement.dataset.ready = "true";
    window.dagou.notifyReady();
    return;
  }
  const audioPromise = withTimeout(
    audio.initialize(window.dagou.loadAudio),
    12_000
  );
  const initialSettings = await initialSettingsPromise;
  if (!receivedSettingsUpdate) applySettings(initialSettings);
  await audioPromise;
  if (settings) sound.configure(settings);
  document.documentElement.dataset.ready = "true";
  window.dagou.notifyReady();
}

void start().catch((error: unknown) => {
  console.error("Failed to initialize Dagou renderer", error);
  window.dagou.notifyFailed(error instanceof Error ? error.message : String(error));
  stage.classList.add("is-paused");
});

window.addEventListener("beforeunload", () => {
  if (resizeFrameId !== null) cancelAnimationFrame(resizeFrameId);
  animator.dispose();
  audio.dispose();
});
