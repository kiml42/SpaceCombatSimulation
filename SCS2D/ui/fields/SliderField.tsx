import { styled } from "@linaria/react";
import { useState } from "react";

const Row = styled.div`
    display: flex;
    gap: 0.4rem;
    align-items: center;
    margin-top: 0.3rem;

    > label {
        flex: 0 0 6.5rem;
        color: var(--colour-muted);
    }

    > input[type="range"] {
        flex: 1;
        min-width: 0;
    }

    > input[type="text"] {
        flex: 0 0 3.2rem;
        min-width: 0;
        padding: 0.1rem 0.25rem;
        border: 1px solid var(--colour-control-border);
        border-radius: 3px;
        background: var(--colour-background);
        color: var(--colour-text);
        text-align: right;
    }

    > span {
        flex: 0 0 0.8rem;
        color: var(--colour-faint);
    }
`;

export interface SliderFieldProps {
    /** The slider's id; the box's is it with `Value` after. */
    readonly id: string;
    readonly label: string;
    /** What the setting means, shown on hover. */
    readonly title: string;
    readonly value: number;
    readonly min: number;
    readonly max: number;
    readonly step: number;
    /** Written after the box: "%", "°", "×". */
    readonly unit?: string;
    /** A new value: `continues` while the slider is still being dragged, and not for one typed. */
    onChange(value: number, continues: boolean): void;
    /** The drag is over. */
    onEnd?(): void;
}

/** Decimal places a step of `step` needs. */
function places(step: number): number {
    const text = String(step);
    const dot = text.indexOf(".");
    return dot < 0 ? 0 : text.length - dot - 1;
}

/**
 * A setting as a slider and the number it is at, one value shown both ways.
 * The number can be typed, taking effect on Enter or on leaving the box, and
 * held to the slider's range; Escape, or something that is not a number, puts
 * back what it was.
 */
export function SliderField({ id, label, title, value, min, max, step, unit, onChange, onEnd }: SliderFieldProps) {
    // What is in the box while it is being typed in; the value itself otherwise.
    const [typed, setTyped] = useState<string | null>(null);
    const shown = value.toFixed(places(step));
    const commit = (): void => {
        if (typed === null) return;
        setTyped(null);
        const number = Number(typed.trim());
        if (typed.trim() === "" || !Number.isFinite(number)) return;
        const held = Math.min(max, Math.max(min, number));
        if (held !== value) onChange(held, false);
    };
    return (
        <Row title={title}>
            <label htmlFor={id}>{label}</label>
            <input
                id={id}
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(event) => onChange(Number(event.currentTarget.value), true)}
                onPointerUp={onEnd}
                onKeyUp={onEnd}
                onBlur={onEnd}
            />
            <input
                id={`${id}Value`}
                type="text"
                inputMode="decimal"
                aria-label={`${label}, typed`}
                value={typed ?? shown}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => setTyped(event.currentTarget.value)}
                onBlur={commit}
                onKeyDown={(event) => {
                    if (event.key === "Enter") commit();
                    else if (event.key === "Escape") setTyped(null);
                }}
            />
            <span aria-hidden="true">{unit}</span>
        </Row>
    );
}
