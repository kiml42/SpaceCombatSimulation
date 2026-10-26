import { Button as BaseButton } from "@base-ui/react/button";
import { Toggle } from "@base-ui/react/toggle";
import { styled } from "@linaria/react";

const Styled = styled.button`
    padding: 0.25rem 0.7rem;
    border: 1px solid var(--colour-control-border);
    border-radius: 4px;
    background: var(--colour-surface);
    color: var(--colour-text);
    font: inherit;
    cursor: pointer;

    &:disabled {
        opacity: 0.5;
        cursor: default;
    }

    &:hover:not(:disabled) {
        background: var(--colour-surface-hover);
    }

    &[data-variant="primary"] {
        border-color: var(--colour-primary-border);
        background: var(--colour-primary);
        color: #fff;
        font-weight: 600;
    }

    &[data-variant="primary"]:hover:not(:disabled) {
        background: var(--colour-primary-hover);
    }

    &[data-variant="icon"] {
        padding: 0 0.3rem;
    }

    &[aria-pressed="true"] {
        border-color: var(--colour-link);
        background: var(--colour-surface-hover);
    }
`;

/** How a button looks: an ordinary one, the one thing to do next, or a small one holding a symbol. */
export type ButtonVariant = "plain" | "primary" | "icon";

export interface ButtonProps extends Omit<BaseButton.Props, "className" | "render"> {
    readonly variant?: ButtonVariant;
    readonly className?: string;
}

/** A button, in the look of every other one. */
export function Button({ variant = "plain", ...rest }: ButtonProps) {
    return <BaseButton {...rest} render={<Styled data-variant={variant} />} />;
}

export interface ToggleButtonProps extends Omit<Toggle.Props, "className" | "render"> {
    readonly variant?: ButtonVariant;
    readonly className?: string;
}

/** A button that stays pressed while what it names is on, and says so (`aria-pressed`). */
export function ToggleButton({ variant = "plain", ...rest }: ToggleButtonProps) {
    return <Toggle {...rest} render={<Styled data-variant={variant} />} />;
}
