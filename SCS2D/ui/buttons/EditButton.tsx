import { styled } from "@linaria/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { PencilIcon } from "../icons/PencilIcon";
import { Button, type ButtonProps } from "./Button";

const Link = styled.a`
    display: inline-flex;
    gap: 0.35rem;
    align-items: center;
    justify-content: center;
    padding: 0.25rem 0.55rem;
    border: 1px solid var(--colour-control-border);
    border-radius: 4px;
    background: var(--colour-surface);
    color: var(--colour-text);
    line-height: 1.5;
    text-decoration: none;

    &:hover {
        background: var(--colour-surface-hover);
    }

    &[data-variant="primary"] {
        border-color: var(--colour-primary-border);
        background: var(--colour-primary);
        color: #fff;
        font-weight: 600;
    }

    &[aria-disabled="true"] {
        opacity: 0.5;
        cursor: default;
    }
`;

interface EditProps {
    /** Its accessible name where it is only a pencil: "Edit Corvette", say. */
    readonly label?: string;
    /** Words after the pencil, which then name it. */
    readonly children?: ReactNode;
}

export interface EditButtonProps extends EditProps, Omit<ButtonProps, "children" | "aria-label"> {}

/** Edit, with a pencil: the one button every screen opens something in its editor with. */
export function EditButton({ label, title, children, ...rest }: EditButtonProps) {
    return (
        <Button {...rest} aria-label={label} title={title ?? label}>
            <PencilIcon />
            {children !== undefined && <> {children}</>}
        </Button>
    );
}

export interface EditLinkProps extends EditProps, Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "children" | "aria-label"> {
    readonly variant?: "plain" | "primary";
}

/** `EditButton` as a link, where Edit goes to an address that can be opened in a new tab. */
export function EditLink({ label, title, children, variant = "plain", ...rest }: EditLinkProps) {
    return (
        <Link {...rest} data-variant={variant} aria-label={label} title={title ?? label}>
            <PencilIcon />
            {children}
        </Link>
    );
}
