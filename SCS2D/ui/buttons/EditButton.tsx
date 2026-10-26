import { styled } from "@linaria/react";
import type { AnchorHTMLAttributes } from "react";
import { PencilIcon } from "../icons/PencilIcon";
import { Button, type ButtonProps } from "./Button";

const Link = styled.a`
    display: inline-block;
    padding: 0.25rem 0.55rem;
    border: 1px solid var(--colour-control-border);
    border-radius: 4px;
    background: var(--colour-surface);
    color: var(--colour-text);
    line-height: 1.5;

    &:hover {
        background: var(--colour-surface-hover);
    }

    &[aria-disabled="true"] {
        opacity: 0.5;
        cursor: default;
    }
`;

export interface EditButtonProps extends Omit<ButtonProps, "children" | "variant" | "aria-label"> {
    /** What it edits, as its accessible name: "Edit Corvette", say. */
    readonly label: string;
}

/** Edit, as a pencil: the one button every screen opens something in its editor with. */
export function EditButton({ label, title, ...rest }: EditButtonProps) {
    return (
        <Button {...rest} aria-label={label} title={title ?? label}>
            <PencilIcon />
        </Button>
    );
}

export interface EditLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "children" | "aria-label"> {
    readonly label: string;
}

/** `EditButton` as a link, where Edit goes to an address that can be opened in a new tab. */
export function EditLink({ label, title, ...rest }: EditLinkProps) {
    return (
        <Link {...rest} aria-label={label} title={title ?? label}>
            <PencilIcon />
        </Link>
    );
}
