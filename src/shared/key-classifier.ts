import type { DogKeyRole } from "./contracts";

export const KEY_CODES = Object.freeze({
  escape: 0x0001,
  backspace: 0x000e,
  tab: 0x000f,
  enter: 0x001c,
  space: 0x0039,
  delete: 0x0e53,
  numpadEnter: 0x0e1c,
  numpadDecimal: 0x0053,
  numpadDelete: 0xee53
});

export const DEFAULT_JIAO_KEY_CODES: readonly number[] = Object.freeze([
  KEY_CODES.escape,
  KEY_CODES.enter,
  KEY_CODES.numpadEnter,
  KEY_CODES.space,
  KEY_CODES.backspace,
  KEY_CODES.delete,
  KEY_CODES.numpadDelete
]);

interface PhysicalKeyDefinition {
  keyCode: number;
  code: string;
  label: string;
  zone: "main" | "function" | "navigation" | "numpad";
  x: number;
  y: number;
  width: number;
  height: number;
}

type KeySeed = readonly [
  keyCode: number,
  code: string,
  label: string,
  x: number,
  y: number,
  width?: number
];

const mainSeeds: readonly KeySeed[] = [
  [0x0029, "Backquote", "`", 0, 0],
  [0x0002, "Digit1", "1", 1, 0],
  [0x0003, "Digit2", "2", 2, 0],
  [0x0004, "Digit3", "3", 3, 0],
  [0x0005, "Digit4", "4", 4, 0],
  [0x0006, "Digit5", "5", 5, 0],
  [0x0007, "Digit6", "6", 6, 0],
  [0x0008, "Digit7", "7", 7, 0],
  [0x0009, "Digit8", "8", 8, 0],
  [0x000a, "Digit9", "9", 9, 0],
  [0x000b, "Digit0", "0", 10, 0],
  [0x000c, "Minus", "-", 11, 0],
  [0x000d, "Equal", "=", 12, 0],
  [KEY_CODES.backspace, "Backspace", "Backspace", 13, 0, 2],
  [KEY_CODES.tab, "Tab", "Tab", 0, 1, 1.5],
  [0x0010, "KeyQ", "Q", 1.5, 1],
  [0x0011, "KeyW", "W", 2.5, 1],
  [0x0012, "KeyE", "E", 3.5, 1],
  [0x0013, "KeyR", "R", 4.5, 1],
  [0x0014, "KeyT", "T", 5.5, 1],
  [0x0015, "KeyY", "Y", 6.5, 1],
  [0x0016, "KeyU", "U", 7.5, 1],
  [0x0017, "KeyI", "I", 8.5, 1],
  [0x0018, "KeyO", "O", 9.5, 1],
  [0x0019, "KeyP", "P", 10.5, 1],
  [0x001a, "BracketLeft", "[", 11.5, 1],
  [0x001b, "BracketRight", "]", 12.5, 1],
  [0x002b, "Backslash", "\\", 13.5, 1, 1.5],
  [0x003a, "CapsLock", "Caps", 0, 2, 1.8],
  [0x001e, "KeyA", "A", 1.8, 2],
  [0x001f, "KeyS", "S", 2.8, 2],
  [0x0020, "KeyD", "D", 3.8, 2],
  [0x0021, "KeyF", "F", 4.8, 2],
  [0x0022, "KeyG", "G", 5.8, 2],
  [0x0023, "KeyH", "H", 6.8, 2],
  [0x0024, "KeyJ", "J", 7.8, 2],
  [0x0025, "KeyK", "K", 8.8, 2],
  [0x0026, "KeyL", "L", 9.8, 2],
  [0x0027, "Semicolon", ";", 10.8, 2],
  [0x0028, "Quote", "'", 11.8, 2],
  [KEY_CODES.enter, "Enter", "Enter", 12.8, 2, 2.2],
  [0x002a, "ShiftLeft", "Shift", 0, 3, 2.3],
  [0x002c, "KeyZ", "Z", 2.3, 3],
  [0x002d, "KeyX", "X", 3.3, 3],
  [0x002e, "KeyC", "C", 4.3, 3],
  [0x002f, "KeyV", "V", 5.3, 3],
  [0x0030, "KeyB", "B", 6.3, 3],
  [0x0031, "KeyN", "N", 7.3, 3],
  [0x0032, "KeyM", "M", 8.3, 3],
  [0x0033, "Comma", ",", 9.3, 3],
  [0x0034, "Period", ".", 10.3, 3],
  [0x0035, "Slash", "/", 11.3, 3],
  [0x0036, "ShiftRight", "Shift", 12.3, 3, 2.7],
  [0x001d, "ControlLeft", "Ctrl", 0, 4, 1.5],
  [0x0e5b, "MetaLeft", "Win", 1.5, 4, 1.3],
  [0x0038, "AltLeft", "Alt", 2.8, 4, 1.3],
  [KEY_CODES.space, "Space", "Space", 4.1, 4, 6.2],
  [0x0e38, "AltRight", "Alt", 10.3, 4, 1.3],
  [0x0e5c, "MetaRight", "Win", 11.6, 4, 1.3],
  [0x0e1d, "ControlRight", "Ctrl", 12.9, 4, 2.1]
];

const functionSeeds: readonly KeySeed[] = [
  [KEY_CODES.escape, "Escape", "Esc", 0, 0],
  ...Array.from({ length: 12 }, (_, index) => [
    index < 10 ? 0x003b + index : 0x0057 + index - 10,
    `F${index + 1}`,
    `F${index + 1}`,
    index + 2,
    0
  ] as const)
];

const navigationSeeds: readonly KeySeed[] = [
  [0x0e52, "Insert", "Insert", 0, 0],
  [0x0e47, "Home", "Home", 1, 0],
  [0x0e49, "PageUp", "Page Up", 2, 0],
  [KEY_CODES.delete, "Delete", "Delete", 0, 1],
  [0x0e4f, "End", "End", 1, 1],
  [0x0e51, "PageDown", "Page Down", 2, 1],
  [0xe048, "ArrowUp", "Up", 1, 2],
  [0xe04b, "ArrowLeft", "Left", 0, 3],
  [0xe050, "ArrowDown", "Down", 1, 3],
  [0xe04d, "ArrowRight", "Right", 2, 3]
];

const numpadSeeds: readonly KeySeed[] = [
  [0x0047, "Numpad7", "Num 7", 0, 0],
  [0x0048, "Numpad8", "Num 8", 1, 0],
  [0x0049, "Numpad9", "Num 9", 2, 0],
  [0x004b, "Numpad4", "Num 4", 0, 1],
  [0x004c, "Numpad5", "Num 5", 1, 1],
  [0x004d, "Numpad6", "Num 6", 2, 1],
  [0x004f, "Numpad1", "Num 1", 0, 2],
  [0x0050, "Numpad2", "Num 2", 1, 2],
  [0x0051, "Numpad3", "Num 3", 2, 2],
  [0x0052, "Numpad0", "Num 0", 0, 3, 2],
  [KEY_CODES.numpadDecimal, "NumpadDecimal", "Num .", 2, 3],
  [0x0037, "NumpadMultiply", "Num *", 0, -1],
  [0x004e, "NumpadAdd", "Num +", 2, -1],
  [0x004a, "NumpadSubtract", "Num -", 1, -1],
  [0x0e35, "NumpadDivide", "Num /", 0, -2],
  [KEY_CODES.numpadEnter, "NumpadEnter", "Num Enter", 2, 2, 1]
];

function definitions(
  seeds: readonly KeySeed[],
  zone: PhysicalKeyDefinition["zone"],
  height: number
): PhysicalKeyDefinition[] {
  return seeds.map(([keyCode, code, label, x, y, width = 1]) => ({
    keyCode,
    code,
    label,
    zone,
    x,
    y,
    width,
    height
  }));
}

export const PHYSICAL_KEYS: readonly PhysicalKeyDefinition[] = Object.freeze([
  ...definitions(mainSeeds, "main", 5),
  ...definitions(functionSeeds, "function", 1),
  ...definitions(navigationSeeds, "navigation", 4),
  ...definitions(numpadSeeds, "numpad", 4)
]);

const byKeyCode = new Map(PHYSICAL_KEYS.map((key) => [key.keyCode, key]));
const byCode = new Map(PHYSICAL_KEYS.map((key) => [key.code, key]));
const keyCodeAliases = new Map<number, number>([
  [KEY_CODES.numpadDelete, KEY_CODES.numpadDecimal],
  [0xee4f, 0x004f],
  [0xee50, 0x0050],
  [0xee51, 0x0051],
  [0xee4b, 0x004b],
  [0xee4d, 0x004d],
  [0xee47, 0x0047],
  [0xee48, 0x0048],
  [0xee49, 0x0049],
  [0xee52, 0x0052]
]);
// Instant mode keeps the original playback-rate response, but exposes eight
// restrained pitch positions instead of collapsing the keyboard into five.
export const MELODY_PITCH_STEPS = Object.freeze([
  -5, -4, -3, -1, 0, 2, 3, 4
] as const);

function zoneWidth(zone: PhysicalKeyDefinition["zone"]): number {
  if (zone === "main") return 15;
  if (zone === "function") return 14;
  return 3;
}

export interface KeyExpression {
  role: DogKeyRole;
  pitchStep: number;
  pan: number;
}

export function describeKeyCode(keyCode: number): string {
  const direct = byKeyCode.get(keyCode);
  const alias = keyCodeAliases.get(keyCode);
  return direct?.label ?? (alias === undefined ? undefined : byKeyCode.get(alias)?.label) ??
    `Key 0x${keyCode.toString(16).toUpperCase()}`;
}

export function keyCodeFromDomCode(code: string): number | null {
  return byCode.get(code)?.keyCode ?? null;
}

export function isSupportedKeyCode(keyCode: number): boolean {
  return byKeyCode.has(keyCode) ||
    byKeyCode.has(keyCodeAliases.get(keyCode) ?? -1);
}

export function resolveKeyExpression(
  keyCode: number,
  jiaoKeyCodes: readonly number[],
  applyPitchMap: boolean
): KeyExpression | null {
  const key = byKeyCode.get(keyCode) ?? byKeyCode.get(keyCodeAliases.get(keyCode) ?? -1);
  if (!key) return null;
  const width = zoneWidth(key.zone);
  const xCenter = key.x + key.width / 2;
  const xNormalized = Math.min(1, Math.max(0, xCenter / width));
  const yNormalized = Math.min(
    1,
    Math.max(0, (key.height - 1 - key.y) / Math.max(1, key.height - 1))
  );
  const gradient = 0.85 * xNormalized + 0.15 * yNormalized;
  const index = Math.min(
    MELODY_PITCH_STEPS.length - 1,
    Math.max(0, Math.round(gradient * (MELODY_PITCH_STEPS.length - 1)))
  );
  return {
    role: jiaoKeyCodes.includes(keyCode) ? "jiao" : "normal",
    pitchStep: applyPitchMap ? MELODY_PITCH_STEPS[index] : 0,
    pan: (xNormalized * 2 - 1) * 0.22
  };
}
