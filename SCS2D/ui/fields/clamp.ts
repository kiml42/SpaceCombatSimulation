import type { FocusEvent } from "react";

/**
 * What a number box should hold once it is left: the nearer end of its range
 * where what was typed is beyond it, or null where it can stay as it is.
 */
export function clampedText(input: HTMLInputElement): string | null {
    const text = input.value.trim();
    const number = Number(text);
    if (text === "" || !Number.isFinite(number)) return null;
    const min = input.min === "" ? -Infinity : Number(input.min);
    const max = input.max === "" ? Infinity : Number(input.max);
    if (number < min) return String(min);
    if (number > max) return String(max);
    return null;
}

/** A box's blur handler that hands on its text clamped, where clamping changed it. */
export const clampOnBlur =
    (apply: (text: string) => void) =>
    (event: FocusEvent<HTMLInputElement>): void => {
        const clamped = clampedText(event.currentTarget);
        if (clamped !== null) apply(clamped);
    };
