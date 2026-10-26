import { useState, type ComponentPropsWithoutRef } from "react";

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
}

/**
 * A box edited as it is typed: the page follows every key, while the box keeps
 * what was typed, half-finished or not, until it is left — then shows what the
 * page made of it.
 */
export function LiveText({ value, onType, onStart, onDone, multiline = false, ...rest }: LiveTextProps) {
    const [typed, setTyped] = useState<string | null>(null);
    const shown = typed ?? value;
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
                setTyped(event.target.value);
                onType(event.target.value);
            }}
            onBlur={done}
            onKeyDown={(event) => {
                if (event.key === "Enter") onDone?.();
            }}
        />
    );
}

export interface LiveNumberProps extends Omit<LiveTextProps, "value" | "onType" | "type" | "multiline"> {
    readonly value: number;
    /** Every key that leaves a number in the box. */
    readonly onEdit: (value: number) => void;
}

/** A number edited as it is typed. */
export function LiveNumber({ value, onEdit, ...rest }: LiveNumberProps) {
    return (
        <LiveText
            {...rest}
            type="number"
            value={String(value)}
            onType={(typed) => {
                const number = Number(typed);
                if (typed.trim() !== "" && Number.isFinite(number)) onEdit(number);
            }}
        />
    );
}
