import { describe, expect, it, vi } from "vitest";
import { windowsVirtualKeyForUiohookCode } from "../src/main/windows-key-state";

describe("windowsVirtualKeyForUiohookCode", () => {
  it("normalizes uiohook extended scan-code prefixes", () => {
    const mapVirtualKey = vi.fn(() => 0x2e);

    expect(
      windowsVirtualKeyForUiohookCode(0x0e53, mapVirtualKey)
    ).toBe(0x2e);
    expect(mapVirtualKey).toHaveBeenCalledWith(0xe053, 3);

    windowsVirtualKeyForUiohookCode(0xe048, mapVirtualKey);
    expect(mapVirtualKey).toHaveBeenLastCalledWith(0xe048, 3);

    expect(
      windowsVirtualKeyForUiohookCode(0xee53, mapVirtualKey)
    ).toBe(0x2e);
    expect(mapVirtualKey).toHaveBeenCalledTimes(2);
  });

  it("maps numpad keys independently of Num Lock", () => {
    const mapVirtualKey = vi.fn(() => 0);

    expect(
      windowsVirtualKeyForUiohookCode(0x004f, mapVirtualKey)
    ).toBe(0x61);
    expect(
      windowsVirtualKeyForUiohookCode(0x0053, mapVirtualKey)
    ).toBe(0x6e);
    expect(
      windowsVirtualKeyForUiohookCode(0x0037, mapVirtualKey)
    ).toBe(0x6a);
    expect(
      windowsVirtualKeyForUiohookCode(0xee4b, mapVirtualKey)
    ).toBe(0x25);
    expect(mapVirtualKey).not.toHaveBeenCalled();
  });

  it("maps extended OEM and high function keys explicitly", () => {
    const mapVirtualKey = vi.fn(() => 0x03);

    expect(
      windowsVirtualKeyForUiohookCode(0x0e46, mapVirtualKey)
    ).toBe(0xe2);
    expect(
      windowsVirtualKeyForUiohookCode(0x005b, mapVirtualKey)
    ).toBe(0x7c);
    expect(
      windowsVirtualKeyForUiohookCode(0x006b, mapVirtualKey)
    ).toBe(0x87);
    expect(
      windowsVirtualKeyForUiohookCode(0xe04c, mapVirtualKey)
    ).toBe(0x0c);
    expect(
      windowsVirtualKeyForUiohookCode(0xe06c, mapVirtualKey)
    ).toBe(0xb6);
    expect(mapVirtualKey).not.toHaveBeenCalled();
  });

  it("handles Pause and rejects unsupported scan-code prefixes", () => {
    const mapVirtualKey = vi.fn(() => 0);

    expect(
      windowsVirtualKeyForUiohookCode(0x0e45, mapVirtualKey)
    ).toBe(0x13);
    expect(
      windowsVirtualKeyForUiohookCode(0xffff, mapVirtualKey)
    ).toBeNull();
    expect(
      windowsVirtualKeyForUiohookCode(0x0073, mapVirtualKey)
    ).toBeNull();
    expect(mapVirtualKey).not.toHaveBeenCalled();
  });

  it("allows Windows-mappable media and browser keys", () => {
    const mapVirtualKey = vi.fn(() => 0xb3);

    expect(
      windowsVirtualKeyForUiohookCode(0xe022, mapVirtualKey)
    ).toBe(0xb3);
    expect(mapVirtualKey).toHaveBeenCalledWith(0xe022, 3);
  });
});
