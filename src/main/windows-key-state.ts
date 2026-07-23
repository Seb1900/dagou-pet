import type { KoffiFunc } from "koffi";

export type PhysicalKeyStateProbe = (keyCode: number) => boolean | null;

const MAPVK_VSC_TO_VK_EX = 3;
const KEY_DOWN_MASK = 0x8000;

const EXPLICIT_VIRTUAL_KEYS = new Map<number, number>([
  [0x0052, 0x60],
  [0x004f, 0x61],
  [0x0050, 0x62],
  [0x0051, 0x63],
  [0x004b, 0x64],
  [0x004c, 0x65],
  [0x004d, 0x66],
  [0x0047, 0x67],
  [0x0048, 0x68],
  [0x0049, 0x69],
  [0x0037, 0x6a],
  [0x004e, 0x6b],
  [0x004a, 0x6d],
  [0x0053, 0x6e],
  [0x0e35, 0x6f],
  [0x0e1c, 0x0d],
  [0xee4f, 0x23],
  [0xee50, 0x28],
  [0xee51, 0x22],
  [0xee4b, 0x25],
  [0xee4d, 0x27],
  [0xee47, 0x24],
  [0xee48, 0x26],
  [0xee49, 0x21],
  [0xee52, 0x2d],
  [0xee53, 0x2e],
  [0x005b, 0x7c],
  [0x005c, 0x7d],
  [0x005d, 0x7e],
  [0x0063, 0x7f],
  [0x0064, 0x80],
  [0x0065, 0x81],
  [0x0066, 0x82],
  [0x0067, 0x83],
  [0x0068, 0x84],
  [0x0069, 0x85],
  [0x006a, 0x86],
  [0x006b, 0x87],
  [0xe04c, 0x0c],
  [0xe06c, 0xb6],
  [0x0e46, 0xe2],
  [0x0e45, 0x13]
]);

const EXTENDED_SCAN_CODES = new Set<number>([
  0x0e1d,
  0x0e37,
  0x0e38,
  0x0e47,
  0x0e49,
  0x0e4f,
  0x0e51,
  0x0e52,
  0x0e53,
  0x0e5b,
  0x0e5c,
  0x0e5d,
  0xe048,
  0xe04b,
  0xe04d,
  0xe050,
  0xe05f,
  0xe022,
  0xe024,
  0xe010,
  0xe019,
  0xe06d,
  0xe020,
  0xe030,
  0xe02e,
  0xe021,
  0xe065,
  0xe032,
  0xe06a,
  0xe069,
  0xe068,
  0xe067,
  0xe066
]);

function isSupportedMappedScanCode(keyCode: number): boolean {
  return (
    (keyCode >= 0x0001 && keyCode <= 0x0046) ||
    keyCode === 0x0057 ||
    keyCode === 0x0058 ||
    EXTENDED_SCAN_CODES.has(keyCode)
  );
}

function windowsScanCode(keyCode: number): number {
  const prefix = keyCode & 0xff00;
  if (prefix === 0x0e00) return 0xe000 | (keyCode & 0xff);
  if (prefix === 0xee00) return keyCode & 0xff;
  return keyCode;
}

export function windowsVirtualKeyForUiohookCode(
  keyCode: number,
  mapVirtualKey: (scanCode: number, mapType: number) => number
): number | null {
  const explicitVirtualKey = EXPLICIT_VIRTUAL_KEYS.get(keyCode);
  if (explicitVirtualKey !== undefined) return explicitVirtualKey;
  if (!isSupportedMappedScanCode(keyCode)) return null;
  const virtualKey = mapVirtualKey(
    windowsScanCode(keyCode),
    MAPVK_VSC_TO_VK_EX
  );
  return virtualKey === 0 ? null : virtualKey;
}

export function createWindowsKeyStateProbe(): PhysicalKeyStateProbe | null {
  if (process.platform !== "win32") return null;
  // Loaded lazily so non-Windows development does not initialize user32.
  const koffi = require("koffi") as typeof import("koffi");
  const user32 = koffi.load("user32.dll");
  const mapVirtualKey = user32.func(
    "uint32 __stdcall MapVirtualKeyW(uint32, uint32)"
  ) as KoffiFunc<(scanCode: number, mapType: number) => number>;
  const getAsyncKeyState = user32.func(
    "short __stdcall GetAsyncKeyState(int)"
  ) as KoffiFunc<(virtualKey: number) => number>;

  return (keyCode) => {
    const virtualKey = windowsVirtualKeyForUiohookCode(
      keyCode,
      mapVirtualKey
    );
    if (virtualKey === null) return null;
    return (getAsyncKeyState(virtualKey) & KEY_DOWN_MASK) !== 0;
  };
}
