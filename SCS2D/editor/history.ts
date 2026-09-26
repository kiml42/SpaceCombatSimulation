/**
 * Undo and redo over whole values, for any editor.
 *
 * Holds snapshots rather than inverse operations: a layout is small, and an
 * undo that replays a stored value cannot half-restore.
 */

/** How many steps back an editor can go. */
export const HISTORY_LIMIT = 100;

export class History<T> {
  private readonly past: T[] = [];
  private readonly future: T[] = [];

  constructor(private value: T) {}

  get current(): T {
    return this.value;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Make a change, keeping the old value to undo to. */
  apply(next: T): void {
    this.past.push(this.value);
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future.length = 0;
    this.value = next;
  }

  /**
   * Continue the last change without a second undo step: a drag is one action
   * to the player and hundreds of values to the editor.
   */
  amend(next: T): void {
    this.value = next;
  }

  /** Start again from a different value. The history belonged to the old one. */
  replace(next: T): void {
    this.past.length = 0;
    this.future.length = 0;
    this.value = next;
  }

  undo(): boolean {
    const previous = this.past.pop();
    if (previous === undefined) return false;
    this.future.push(this.value);
    this.value = previous;
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (next === undefined) return false;
    this.past.push(this.value);
    this.value = next;
    return true;
  }
}
