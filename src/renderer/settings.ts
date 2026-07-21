import {
  PET_SCALE_MAX,
  PET_SCALE_MIN,
  REACTION_INTENSITY_MAX,
  REACTION_INTENSITY_MIN,
  type AppSettings,
  type SoundMode
} from "../shared/settings";
import {
  DEFAULT_JIAO_KEY_CODES,
  describeKeyCode,
  keyCodeFromDomCode
} from "../shared/key-classifier";

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Settings renderer is missing ${selector}`);
  return element;
}

const modeInputs = [...document.querySelectorAll<HTMLInputElement>(
  'input[name="sound-mode"]'
)];
const volume = requireElement<HTMLInputElement>("#volume");
const volumeValue = requireElement<HTMLElement>("#volume-value");
const petScale = requireElement<HTMLInputElement>("#pet-scale");
const petScaleValue = requireElement<HTMLElement>("#pet-scale-value");
const reactionIntensity = requireElement<HTMLInputElement>("#reaction-intensity");
const reactionIntensityValue = requireElement<HTMLElement>(
  "#reaction-intensity-value"
);
const flipHorizontal = requireElement<HTMLInputElement>("#flip-horizontal");
const flipVertical = requireElement<HTMLInputElement>("#flip-vertical");
const alwaysOnTop = requireElement<HTMLInputElement>("#always-on-top");
const melodyEnabled = requireElement<HTMLInputElement>("#melody-enabled");
const jiaoPitch = requireElement<HTMLInputElement>("#jiao-pitch");
const jiaoPitchValue = requireElement<HTMLElement>("#jiao-pitch-value");
const jiaoKeys = requireElement<HTMLElement>("#jiao-keys");
const keyCount = requireElement<HTMLElement>("#key-count");
const captureKey = requireElement<HTMLButtonElement>("#capture-key");
const restoreKeys = requireElement<HTMLButtonElement>("#restore-keys");
const captureState = requireElement<HTMLElement>("#capture-state");
const saveState = requireElement<HTMLElement>("#save-state");

let settings: AppSettings | null = null;
let capturing = false;
let saveSequence = 0;

petScale.min = String(PET_SCALE_MIN * 100);
petScale.max = String(PET_SCALE_MAX * 100);
reactionIntensity.min = String(REACTION_INTENSITY_MIN * 100);
reactionIntensity.max = String(REACTION_INTENSITY_MAX * 100);

function render(): void {
  if (!settings) return;
  for (const input of modeInputs) input.checked = input.value === settings.soundMode;
  volume.value = String(Math.round(settings.volume * 100));
  volumeValue.textContent = `${volume.value}%`;
  petScale.value = String(Math.round(settings.scale * 100));
  petScaleValue.textContent = `${petScale.value}%`;
  reactionIntensity.value = String(
    Math.round(settings.reactionIntensity * 100)
  );
  reactionIntensityValue.textContent = `${reactionIntensity.value}%`;
  flipHorizontal.checked = settings.flipHorizontal;
  flipVertical.checked = settings.flipVertical;
  alwaysOnTop.checked = settings.alwaysOnTop;
  melodyEnabled.checked = settings.melodyEnabled;
  jiaoPitch.value = String(settings.jiaoSustainPitch);
  const pitch = settings.jiaoSustainPitch;
  jiaoPitchValue.textContent = `${pitch > 0 ? "+" : ""}${pitch} 半音`;
  renderKeys();
}

function renderKeys(): void {
  if (!settings) return;
  jiaoKeys.replaceChildren();
  keyCount.textContent = `${settings.jiaoKeyCodes.length} 个`;
  if (settings.jiaoKeyCodes.length === 0) {
    const empty = document.createElement("span");
    empty.className = "empty-keys";
    empty.textContent = "当前没有叫键";
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

async function persist(patch: Partial<AppSettings>): Promise<void> {
  if (!settings) return;
  const sequence = ++saveSequence;
  settings = { ...settings, ...patch };
  render();
  saveState.textContent = "保存中";
  try {
    const saved = await window.dagou.updateSettings(patch);
    if (sequence === saveSequence) {
      settings = saved;
      render();
      saveState.textContent = "已保存";
    }
  } catch {
    if (sequence === saveSequence) saveState.textContent = "保存失败";
  }
}

function setCapturing(value: boolean): void {
  capturing = value;
  captureKey.classList.toggle("is-capturing", value);
  captureKey.textContent = value ? "取消录入" : "添加按键";
  captureState.textContent = value ? "等待按键..." : "";
}

for (const input of modeInputs) {
  input.addEventListener("change", () => {
    if (input.checked) void persist({ soundMode: input.value as SoundMode });
  });
}

volume.addEventListener("input", () => {
  volumeValue.textContent = `${volume.value}%`;
});
volume.addEventListener("change", () => {
  void persist({ volume: Number(volume.value) / 100 });
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
  void persist({
    reactionIntensity: Number(reactionIntensity.value) / 100
  });
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
melodyEnabled.addEventListener("change", () => {
  void persist({ melodyEnabled: melodyEnabled.checked });
});
jiaoPitch.addEventListener("input", () => {
  const value = Number(jiaoPitch.value);
  jiaoPitchValue.textContent = `${value > 0 ? "+" : ""}${value} 半音`;
});
jiaoPitch.addEventListener("change", () => {
  void persist({ jiaoSustainPitch: Number(jiaoPitch.value) });
});
captureKey.addEventListener("click", () => setCapturing(!capturing));
restoreKeys.addEventListener("click", () => {
  void persist({ jiaoKeyCodes: [...DEFAULT_JIAO_KEY_CODES] });
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

void window.dagou.getSettings().then(
  (initialSettings) => {
    settings = initialSettings;
    render();
    document.documentElement.dataset.ready = "true";
    window.dagou.notifyReady();
  },
  (error: unknown) => {
    window.dagou.notifyFailed(
      error instanceof Error ? error.message : String(error)
    );
  }
);
