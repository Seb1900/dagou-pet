export class PressedKeyTracker {
  private readonly pressed = new Set<number>();

  keyDown(keyCode: number): boolean {
    if (this.pressed.has(keyCode)) return false;
    this.pressed.add(keyCode);
    return true;
  }

  keyUp(keyCode: number): boolean {
    if (!this.pressed.has(keyCode)) return false;
    this.pressed.delete(keyCode);
    return true;
  }

  reset(): void {
    this.pressed.clear();
  }

  get heldCount(): number {
    return this.pressed.size;
  }
}
