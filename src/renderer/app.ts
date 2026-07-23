import "./styles.css";
import idleDogUrl from "../../assets/dagou/sprites/idle.png?url";
import idleScaleDogUrl from "../../assets/dagou/sprites/idle-scale.png?url";
import shyDogUrl from "../../assets/dagou/sprites/idle-shy.png?url";
import shyTailDogUrl from "../../assets/dagou/sprites/idle-shy-tail.png?url";
import bark01DogUrl from "../../assets/dagou/sprites/bark01.png?url";
import bark02DogUrl from "../../assets/dagou/sprites/bark02.png?url";
import {
  AUDIO_SAMPLE_NAMES,
  type DogInputEvent,
  type PetDragRegion,
  type PetMoveRequest
} from "../shared/contracts";
import type { AppSettings } from "../shared/settings";
import {
  positionFromDragPointer,
  scaleFromResizePointer
} from "../shared/window-geometry";
import { AudioEngine } from "./audio-engine";
import { DogAnimator } from "./dog-animation";
import { SoundController } from "./sound-controller";
import { createEiVoiceSpec } from "./sound-profile";

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
const shyGroup = requireElement<HTMLElement>("#dog-shy-group");
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

const spriteImages = [
  idleImage,
  shyImage,
  shyTailImage,
  bark01Image,
  bark02Image,
  idleScaleImage
];

type PresentedDogState = "idle" | "shy" | "bark01" | "bark02" | "scale";

const STATE_FADE_MS = 180;
const STATE_FADE_FALLBACK_MS = STATE_FADE_MS + 34;

class DogStatePresenter {
  private readonly layers: Record<PresentedDogState, HTMLElement>;
  private logicalState: Exclude<PresentedDogState, "scale"> = "idle";
  private committedState: PresentedDogState = "idle";
  private requestedState: PresentedDogState = "idle";
  private scaleOverride = false;
  private transitionEpoch = 0;
  private commitTimerId: number | null = null;
  private removeTransitionListener: (() => void) | null = null;

  constructor(layers: Record<PresentedDogState, HTMLElement>) {
    this.layers = layers;
    for (const layer of Object.values(this.layers)) {
      layer.classList.add("dog-visual-layer");
    }
    this.layers.idle.classList.add("is-dog-state-base");
  }

  setLogicalState(state: Exclude<PresentedDogState, "scale">): void {
    this.logicalState = state;
    this.transitionTo(this.resolveTarget());
  }

  setScaleOverride(enabled: boolean): void {
    this.scaleOverride = enabled;
    this.transitionTo(this.resolveTarget());
  }

  dispose(): void {
    this.transitionEpoch += 1;
    this.cancelPendingCommit();
  }

  private resolveTarget(): PresentedDogState {
    return this.scaleOverride ? "scale" : this.logicalState;
  }

  private transitionTo(target: PresentedDogState): void {
    if (target === this.requestedState) return;
    this.requestedState = target;
    const epoch = ++this.transitionEpoch;
    this.cancelPendingCommit();

    const baseLayer = this.layers[this.committedState];
    const frozenOpacity = new Map<HTMLElement, number>();
    for (const layer of Object.values(this.layers)) {
      const opacity = layer === baseLayer
        ? 1
        : Number.parseFloat(window.getComputedStyle(layer).opacity);
      frozenOpacity.set(layer, Number.isFinite(opacity) ? opacity : 0);
    }

    for (const layer of Object.values(this.layers)) {
      layer.classList.remove("is-dog-state-transitioning");
      layer.style.opacity = String(frozenOpacity.get(layer) ?? 0);
      layer.style.zIndex = "0";
    }
    baseLayer.style.opacity = "1";
    void baseLayer.offsetWidth;

    const targetLayer = this.layers[target];
    if (target === this.committedState) {
      for (const layer of Object.values(this.layers)) {
        if (layer === baseLayer) continue;
        layer.style.zIndex = "1";
        layer.classList.add("is-dog-state-transitioning");
        layer.style.opacity = "0";
      }
    } else {
      for (const layer of Object.values(this.layers)) {
        if (layer === baseLayer || layer === targetLayer) continue;
        layer.classList.add("is-dog-state-transitioning");
        layer.style.opacity = "0";
      }
      targetLayer.style.zIndex = "1";
      targetLayer.classList.add("is-dog-state-transitioning");
      targetLayer.style.opacity = "1";
      const onTransitionEnd = (event: TransitionEvent): void => {
        if (event.propertyName === "opacity") this.commit(epoch, target);
      };
      targetLayer.addEventListener("transitionend", onTransitionEnd);
      this.removeTransitionListener = () => {
        targetLayer.removeEventListener("transitionend", onTransitionEnd);
      };
    }

    this.commitTimerId = window.setTimeout(
      () => this.commit(epoch, target),
      STATE_FADE_FALLBACK_MS
    );
  }

  private commit(epoch: number, target: PresentedDogState): void {
    if (epoch !== this.transitionEpoch || target !== this.requestedState) return;
    this.cancelPendingCommit();
    this.committedState = target;
    for (const [state, layer] of Object.entries(this.layers) as Array<
      [PresentedDogState, HTMLElement]
    >) {
      layer.classList.toggle("is-dog-state-base", state === target);
      layer.classList.remove("is-dog-state-transitioning");
      layer.style.removeProperty("opacity");
      layer.style.removeProperty("z-index");
    }
  }

  private cancelPendingCommit(): void {
    if (this.commitTimerId !== null) {
      window.clearTimeout(this.commitTimerId);
      this.commitTimerId = null;
    }
    this.removeTransitionListener?.();
    this.removeTransitionListener = null;
  }

}

async function decodeSpriteImages(): Promise<void> {
  await Promise.all(spriteImages.map(async (image) => {
    await image.decode();
    if (image.naturalWidth === 0 || image.naturalHeight === 0) {
      throw new Error(`Sprite failed to decode: ${image.src}`);
    }
  }));
}

function logicalDogStateFromClasses(): Exclude<PresentedDogState, "scale"> {
  if (dog.classList.contains("is-bark02")) return "bark02";
  if (dog.classList.contains("is-bark01")) return "bark01";
  if (dog.classList.contains("is-shy")) return "shy";
  return "idle";
}

const audio = new AudioEngine();
const sound = new SoundController(audio);
const animator = new DogAnimator(dog, jelly);
const statePresenter = new DogStatePresenter({
  idle: idleImage,
  shy: shyGroup,
  bark01: bark01Image,
  bark02: bark02Image,
  scale: idleScaleImage
});
const dogStateObserver = new MutationObserver(() => {
  statePresenter.setLogicalState(logicalDogStateFromClasses());
});
dogStateObserver.observe(dog, {
  attributes: true,
  attributeFilter: ["class"]
});
let settings: AppSettings | null = null;
let dragGesture: {
  pointerId: number;
  startScreenX: number;
  startScreenY: number;
  startWindowX: number;
  startWindowY: number;
  dragRegion: PetDragRegion;
  moved: boolean;
} | null = null;
let pendingMove: PetMoveRequest | null = null;
let moveFrameId: number | null = null;
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
let currentResizeScale: number | null = null;
let petMouseInteractive = false;
let lastPointerPosition: { x: number; y: number } | null = null;
let mouseFilterFrameId: number | null = null;

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
  if (nextSettings.clickThrough) cancelPointerGestures();
  audio.setVolume(nextSettings.volume);
  sound.configure(nextSettings);
  animator.setReactionIntensity(nextSettings.reactionIntensity);
  dog.classList.toggle("is-flipped-horizontal", nextSettings.flipHorizontal);
  dog.classList.toggle("is-flipped-vertical", nextSettings.flipVertical);
  stage.classList.toggle("is-paused", !nextSettings.listening);
  stage.classList.toggle("is-click-through", nextSettings.clickThrough);
  updatePetMouseInteraction();
  if (!nextSettings.listening) {
    animator.reset();
    sound.reset();
  }
}

function setScaleHover(value: boolean): void {
  dog.classList.toggle("is-scale-hover", value);
  statePresenter.setScaleOverride(value);
}

function cancelPointerGestures(): void {
  if (dragGesture && dogHitbox.hasPointerCapture(dragGesture.pointerId)) {
    dogHitbox.releasePointerCapture(dragGesture.pointerId);
  }
  if (resizeGesture && scaleHandle.hasPointerCapture(resizeGesture.pointerId)) {
    scaleHandle.releasePointerCapture(resizeGesture.pointerId);
  }
  dragGesture = null;
  resizeGesture = null;
  pendingMove = null;
  pendingResizeScale = null;
  currentResizeScale = null;
  if (moveFrameId !== null) cancelAnimationFrame(moveFrameId);
  if (resizeFrameId !== null) cancelAnimationFrame(resizeFrameId);
  moveFrameId = null;
  resizeFrameId = null;
  stage.classList.remove("is-dragging", "is-resizing");
  setScaleHover(false);
}

function containsClientPoint(
  element: HTMLElement,
  clientX: number,
  clientY: number
): boolean {
  const rect = element.getBoundingClientRect();
  return clientX >= rect.left && clientX <= rect.right &&
    clientY >= rect.top && clientY <= rect.bottom;
}

function updatePetMouseInteraction(
  clientX = lastPointerPosition?.x,
  clientY = lastPointerPosition?.y
): void {
  const gestureActive = dragGesture !== null || resizeGesture !== null;
  const pointerInside = clientX !== undefined && clientY !== undefined && (
    containsClientPoint(dogHitbox, clientX, clientY) ||
    containsClientPoint(scaleHandle, clientX, clientY)
  );
  const interactive = !settings?.clickThrough && (gestureActive || pointerInside);
  if (interactive === petMouseInteractive) return;
  petMouseInteractive = interactive;
  window.dagou.setPetMouseInteractive(interactive);
}

function monitorPetMouseInteraction(): void {
  mouseFilterFrameId = null;
  if (!lastPointerPosition) return;
  updatePetMouseInteraction(lastPointerPosition.x, lastPointerPosition.y);
  mouseFilterFrameId = requestAnimationFrame(monitorPetMouseInteraction);
}

function startPetMouseMonitor(): void {
  if (mouseFilterFrameId === null) {
    mouseFilterFrameId = requestAnimationFrame(monitorPetMouseInteraction);
  }
}

window.addEventListener("mousemove", (event) => {
  lastPointerPosition = { x: event.clientX, y: event.clientY };
  updatePetMouseInteraction(event.clientX, event.clientY);
  startPetMouseMonitor();
});
window.addEventListener("mouseleave", () => {
  lastPointerPosition = null;
  if (mouseFilterFrameId !== null) cancelAnimationFrame(mouseFilterFrameId);
  mouseFilterFrameId = null;
  updatePetMouseInteraction();
});

function sendPendingMove(): void {
  if (moveFrameId !== null) cancelAnimationFrame(moveFrameId);
  moveFrameId = null;
  if (!pendingMove) return;
  const request = pendingMove;
  pendingMove = null;
  window.dagou.movePet(request);
}

function queueMove(
  x: number,
  y: number,
  pointerX: number,
  pointerY: number,
  dragRegion: PetDragRegion
): void {
  pendingMove = {
    position: { x, y },
    pointer: { x: pointerX, y: pointerY },
    dragRegion
  };
  if (moveFrameId !== null) return;
  moveFrameId = requestAnimationFrame(sendPendingMove);
}

function finishDrag(event: PointerEvent, allowPet: boolean): void {
  if (!dragGesture || event.pointerId !== dragGesture.pointerId) return;
  const gesture = dragGesture;
  dragGesture = null;
  const shouldPet = allowPet && !gesture.moved;
  if (gesture.moved) sendPendingMove();
  if (dogHitbox.hasPointerCapture(event.pointerId)) {
    dogHitbox.releasePointerCapture(event.pointerId);
  }
  stage.classList.remove("is-dragging");
  lastPointerPosition = { x: event.clientX, y: event.clientY };
  updatePetMouseInteraction(event.clientX, event.clientY);
  if (shouldPet) {
    animator.pet();
    audio.playOneShot(createEiVoiceSpec());
  }
}

function sendPendingResize(): void {
  if (resizeFrameId !== null) cancelAnimationFrame(resizeFrameId);
  resizeFrameId = null;
  if (pendingResizeScale === null) return;
  const scale = pendingResizeScale;
  pendingResizeScale = null;
  window.dagou.resizePet(scale);
}

function queueResize(scale: number): void {
  currentResizeScale = scale;
  pendingResizeScale = scale;
  if (resizeFrameId !== null) return;
  resizeFrameId = requestAnimationFrame(sendPendingResize);
}

function finishResize(event: PointerEvent): void {
  if (!resizeGesture || event.pointerId !== resizeGesture.pointerId) return;
  sendPendingResize();
  const finalScale = currentResizeScale;
  if (scaleHandle.hasPointerCapture(event.pointerId)) {
    scaleHandle.releasePointerCapture(event.pointerId);
  }
  resizeGesture = null;
  currentResizeScale = null;
  stage.classList.remove("is-resizing");
  setScaleHover(scaleHandle.matches(":hover"));
  lastPointerPosition = { x: event.clientX, y: event.clientY };
  updatePetMouseInteraction(event.clientX, event.clientY);
  if (finalScale !== null) {
    void window.dagou.updateSettings({ scale: finalScale }).catch(
      (error: unknown) => console.error("Failed to save Dagou scale", error)
    );
  }
}

function openSettingsFromContextMenu(event: MouseEvent): void {
  if (settings?.clickThrough) return;
  event.preventDefault();
  event.stopPropagation();
  const hitboxRect = dogHitbox.getBoundingClientRect();
  window.dagou.openSettings({
    x: hitboxRect.left,
    y: hitboxRect.top,
    width: hitboxRect.width,
    height: hitboxRect.height
  });
}

dogHitbox.addEventListener("pointerenter", () => animator.showShy());
dogHitbox.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || settings?.clickThrough) return;
  event.preventDefault();
  event.stopPropagation();
  const hitboxRect = dogHitbox.getBoundingClientRect();
  dragGesture = {
    pointerId: event.pointerId,
    startScreenX: event.screenX,
    startScreenY: event.screenY,
    startWindowX: window.screenX,
    startWindowY: window.screenY,
    dragRegion: {
      x: hitboxRect.left,
      y: hitboxRect.top,
      width: hitboxRect.width,
      height: hitboxRect.height
    },
    moved: false
  };
  updatePetMouseInteraction(event.clientX, event.clientY);
  dogHitbox.setPointerCapture(event.pointerId);
});
dogHitbox.addEventListener("pointermove", (event) => {
  if (!dragGesture || event.pointerId !== dragGesture.pointerId) return;
  const position = positionFromDragPointer({
    startWindowX: dragGesture.startWindowX,
    startWindowY: dragGesture.startWindowY,
    deltaX: event.screenX - dragGesture.startScreenX,
    deltaY: event.screenY - dragGesture.startScreenY
  });
  if (!dragGesture.moved && !position.moved) return;
  if (!dragGesture.moved) {
    dragGesture.moved = true;
    animator.wakeFromShy();
    stage.classList.add("is-dragging");
  }
  queueMove(
    position.x,
    position.y,
    event.screenX,
    event.screenY,
    dragGesture.dragRegion
  );
});
dogHitbox.addEventListener("pointerup", (event) => finishDrag(event, true));
dogHitbox.addEventListener("pointercancel", (event) => finishDrag(event, false));
dogHitbox.addEventListener("contextmenu", openSettingsFromContextMenu);

scaleHandle.addEventListener("pointerenter", () => {
  animator.wakeFromShy();
  setScaleHover(true);
});
scaleHandle.addEventListener("pointerleave", () => {
  if (!resizeGesture) setScaleHover(false);
});
scaleHandle.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || !settings || settings.clickThrough) return;
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
  updatePetMouseInteraction(event.clientX, event.clientY);
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
scaleHandle.addEventListener("contextmenu", openSettingsFromContextMenu);

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
  const spritesPromise = withTimeout(decodeSpriteImages(), 12_000);
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
        [
          spritesPromise,
          ...AUDIO_SAMPLE_NAMES.map(async (name) => {
            const bytes = await window.dagou.loadAudio(name);
            const decoded = await decoder.decodeAudioData(bytes.slice(0));
            if (decoded.length === 0) throw new Error(`${name} decoded empty`);
          })
        ]
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
  const rendererAssetsPromise = Promise.all([audioPromise, spritesPromise]);
  const initialSettings = await initialSettingsPromise;
  if (!receivedSettingsUpdate) applySettings(initialSettings);
  await rendererAssetsPromise;
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
  if (moveFrameId !== null) cancelAnimationFrame(moveFrameId);
  if (resizeFrameId !== null) cancelAnimationFrame(resizeFrameId);
  if (mouseFilterFrameId !== null) cancelAnimationFrame(mouseFilterFrameId);
  window.dagou.setPetMouseInteractive(false);
  dogStateObserver.disconnect();
  statePresenter.dispose();
  animator.dispose();
  sound.reset();
  audio.dispose();
});
