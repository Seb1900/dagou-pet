import { describe, expect, it } from "vitest";
import {
  DEFAULT_JIAO_KEY_CODES,
  KEY_CODES,
  MELODY_PITCH_STEPS,
  PHYSICAL_KEYS,
  describeKeyCode,
  keyCodeFromDomCode,
  resolveKeyExpression
} from "../src/shared/key-classifier";

describe("physical key mapping", () => {
  it("uses Escape, enter, space, backspace and delete as default jiao keys", () => {
    for (const keyCode of [
      KEY_CODES.escape,
      KEY_CODES.enter,
      KEY_CODES.numpadEnter,
      KEY_CODES.space,
      KEY_CODES.backspace,
      KEY_CODES.delete,
      KEY_CODES.numpadDelete
    ]) {
      expect(resolveKeyExpression(keyCode, DEFAULT_JIAO_KEY_CODES, true).role).toBe(
        "jiao"
      );
    }
  });

  it("supports custom jiao keys without exposing typed characters", () => {
    const a = keyCodeFromDomCode("KeyA");
    expect(a).not.toBeNull();
    expect(resolveKeyExpression(a!, [a!], true).role).toBe("jiao");
    expect(describeKeyCode(a!)).toBe("A");
  });

  it("maps the main keyboard monotonically from left to right", () => {
    const left = resolveKeyExpression(keyCodeFromDomCode("KeyA")!, [], true);
    const middle = resolveKeyExpression(keyCodeFromDomCode("KeyG")!, [], true);
    const right = resolveKeyExpression(keyCodeFromDomCode("Enter")!, [], true);
    expect(left.pitchStep).toBeLessThan(middle.pitchStep);
    expect(middle.pitchStep).toBeLessThan(right.pitchStep);
    expect(left.pan).toBeLessThan(right.pan);
  });

  it("exposes eight restrained pitch positions across the keyboard", () => {
    const pitches = new Set(
      PHYSICAL_KEYS.map((key) =>
        resolveKeyExpression(key.keyCode, [], true).pitchStep
      )
    );

    expect(MELODY_PITCH_STEPS).toHaveLength(8);
    expect(pitches).toEqual(new Set(MELODY_PITCH_STEPS));
    expect(Math.min(...MELODY_PITCH_STEPS)).toBeGreaterThanOrEqual(-5);
    expect(Math.max(...MELODY_PITCH_STEPS)).toBeLessThanOrEqual(5);
  });

  it("can disable the pitch map while preserving roles", () => {
    const expression = resolveKeyExpression(KEY_CODES.space, DEFAULT_JIAO_KEY_CODES, false);
    expect(expression).toMatchObject({ role: "jiao", pitchStep: 0 });
  });
});
