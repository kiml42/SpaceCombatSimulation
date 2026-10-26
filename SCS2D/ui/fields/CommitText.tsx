import type { ComponentPropsWithoutRef } from "react";

export interface CommitTextProps extends Omit<ComponentPropsWithoutRef<"input">, "value" | "defaultValue" | "onChange"> {
    readonly value: string;
    /** What was typed, once the box is left or Enter is pressed, if it differs from `value`. */
    readonly onCommit: (typed: string) => void;
    /** A box of several lines, where Enter is a new line and only leaving it commits. */
    readonly multiline?: boolean;
}

/**
 * A text box whose edit counts once it is finished, not at every key: a name
 * whose every half-typed state would otherwise be an undo step of its own.
 */
export function CommitText({ value, onCommit, multiline = false, ...rest }: CommitTextProps) {
    const commit = (typed: string): void => {
        if (typed !== value) onCommit(typed);
    };
    if (multiline) {
        const { id, title, placeholder, className, "aria-label": label } = rest;
        return (
            <textarea
                // Put back to what it now holds whenever that changes.
                key={value}
                id={id}
                title={title}
                placeholder={placeholder}
                className={className}
                aria-label={label}
                defaultValue={value}
                onBlur={(event) => commit(event.target.value)}
            />
        );
    }
    return (
        <input
            key={value}
            type="text"
            {...rest}
            defaultValue={value}
            onBlur={(event) => commit(event.target.value)}
            onKeyDown={(event) => {
                if (event.key === "Enter") commit(event.currentTarget.value);
            }}
        />
    );
}
