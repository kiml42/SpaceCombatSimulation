import { styled } from "@linaria/react";
import type { ReactNode } from "react";
import { Button } from "~/ui/buttons/Button";

const Box = styled.div`
    position: absolute;
    top: 50%;
    left: 50%;
    z-index: 2;
    width: max-content;
    max-width: calc(100% - 2rem);
    padding: 1rem 1.2rem 0.9rem;
    border: 1px solid var(--colour-control-border);
    border-radius: 6px;
    background: rgb(11 15 22 / 92%);
    box-shadow: 0 0.4rem 1.5rem #000a;
    text-align: center;
    transform: translate(-50%, -50%);

    h2 {
        margin: 0 0 0.3rem;
        color: var(--colour-heading);
        font-size: 1.1rem;
    }

    > p {
        max-width: 34rem;
        margin: 0 auto 0.8rem;
        color: var(--colour-muted);
    }

    [role="group"] {
        justify-content: center;
    }
`;

/** A choice laid over the paused battle that led to it, which can be put off to go on watching. */
export function PickOverlay({
    id,
    title,
    text,
    onLater,
    children,
}: {
    readonly id: string;
    readonly title: string;
    readonly text: string;
    readonly onLater: () => void;
    /** The choices. */
    readonly children: ReactNode;
}) {
    return (
        <Box id={id} role="dialog" aria-labelledby={`${id}Title`}>
            <h2 id={`${id}Title`}>{title}</h2>
            <p>{text}</p>
            {children}
            <Button id={`${id}Later`} onClick={onLater}>
                Continue watching
            </Button>
        </Box>
    );
}
