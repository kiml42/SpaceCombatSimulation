import { useRef, useState, type ComponentPropsWithoutRef } from "react";

export interface LiveTextProps extends Omit<
    ComponentPropsWithoutRef<"input">,
    "value" | "defaultValue" | "onChange" | "onFocus" | "onBlur" | "onKeyDown"
> {
    /** What the thing being edited holds, shown whenever the box is not being typed in. */
    readonly value: string;
    /** Every key: the page applies what it can read, and ignores what it cannot yet. */
    readonly onType: (typed: string) => void;
    /** The box is entered: what is typed next is a new edit. */
    readonly onStart?: () => void;
    /** The box is left, or Enter pressed: the edit is finished. */
    readonly onDone?: () => void;
    /** A box of several lines. */
    readonly multiline?: boolean;
    /** What an empty number box's arrows step from, rather than the browser's 0. */
    readonly stepFrom?: number;
}

/**
 * A box edited as it is typed: the page follows every key, while the box keeps
 * what was typed, half-finished or not, until it is left — then shows what the
 * page made of it.
 */
export function LiveText({ value, onType, onStart, onDone, multiline = false, stepFrom, ...rest }: LiveTextProps) {
    const [typed, setTyped] = useState<string | null>(null);
    const stepping = useRef(false);
    const shown = typed ?? value;
    // An arrow on an empty box steps from 0, so the step is moved onto stepFrom.
    const read = (raw: string): string => {
        const delta = Number(raw);
        if (stepFrom === undefined || !stepping.current || shown !== "" || raw === "" || delta === 0) return raw;
        return String(Number((stepFrom + delta).toPrecision(12)));
    };
    const start = (): void => {
        setTyped(value);
        onStart?.();
    };
    const done = (): void => {
        setTyped(null);
        onDone?.();
    };
    if (multiline) {
        const { id, title, placeholder, className, "aria-label": label } = rest;
        return (
            <textarea
                id={id}
                title={title}
                placeholder={placeholder}
                className={className}
                aria-label={label}
                value={shown}
                onFocus={start}
                onChange={(event) => {
                    setTyped(event.target.value);
                    onType(event.target.value);
                }}
                onBlur={done}
            />
        );
    }
    return (
        <input
            type="text"
            {...rest}
            value={shown}
            onFocus={start}
            onChange={(event) => {
                const next = read(event.target.value);
                setTyped(next);
                onType(next);
            }}
            onBlur={done}
            onPointerDown={() => (stepping.current = true)}
            onPointerUp={() => (stepping.current = false)}
            onPointerCancel={() => (stepping.current = false)}
            onKeyDown={(event) => {
                stepping.current = event.key === "ArrowUp" || event.key === "ArrowDown";
                if (event.key === "Enter") onDone?.();
            }}
            onKeyUp={() => (stepping.current = false)}
        />
    );
}

export interface LiveNumberProps extends Omit<LiveTextProps, "value" | "onType" | "type" | "multiline"> {
    readonly value: number;
    readonly min?: number;
    readonly max?: number;
    /** Every key that leaves a number within min and max in the box. */
    readonly onEdit: (value: number) => void;
}

/** A number edited as it is typed. */
export function LiveNumber({ value, onEdit, min, max, ...rest }: LiveNumberProps) {
    return (
        <LiveText
            {...rest}
            {...(min === undefined ? {} : { min })}
            {...(max === undefined ? {} : { max })}
            type="number"
            value={String(value)}
            onType={(typed) => {
                const number = Number(typed);
                // Half-typed, "0.5" is "0" first: out of range waits for the next key.
                if (typed.trim() === "" || !Number.isFinite(number)) return;
                if ((min !== undefined && number < min) || (max !== undefined && number > max)) return;
                onEdit(number);
            }}
        />
    );
}
