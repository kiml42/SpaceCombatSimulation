import { styled } from "@linaria/react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "~/ui/buttons/Button";

/** One step of a tour: what to do, where, and whether it has been done. */
export interface TourStep {
    readonly id: string;
    readonly title: string;
    readonly body: ReactNode;
    /** What it is about, as selectors: the first one showing is outlined and the step sits beside it. */
    readonly targets?: readonly string[];
    /** What the step sits beside instead, at the target's height, or at the foot of the view with no target. */
    readonly beside?: string;
    /** What having done it looks like, ticked off while it is true: the step waits for Next either way. */
    readonly goal?: { readonly label: string; readonly done: boolean };
}

export interface TourProps {
    /** The callout's id; its title, goal, buttons and outline are this with `Title`, `Goal`, `Back`, `Next`, `End` and `Ring` on the end. */
    readonly id: string;
    readonly steps: readonly TourStep[];
    readonly at: number;
    readonly onAt: (at: number) => void;
    readonly onEnd: () => void;
}

const WIDTH = 288;
const GAP = 12;
const MARGIN = 8;

const Callout = styled.section`
    position: fixed;
    z-index: 20;
    box-sizing: border-box;
    width: ${`${WIDTH}px`};
    max-width: calc(100vw - 16px);
    padding: 0.8rem 1rem;
    border: 1px solid var(--colour-primary-border);
    border-radius: 6px;
    background: var(--colour-surface);
    color: var(--colour-text);
    box-shadow: 0 6px 24px rgb(0 0 0 / 45%);

    && h2 {
        display: block;
        margin: 0.15rem 0 0.35rem;
        color: var(--colour-heading);
        font-size: 1rem;
        font-weight: 600;
        letter-spacing: normal;
        text-transform: none;
    }

    p {
        margin: 0 0 0.4rem;
        color: var(--colour-muted);
    }

    strong {
        color: var(--colour-heading);
    }
`;

const Count = styled.div`
    color: var(--colour-faint);
    font-size: 0.8rem;
`;

const Goal = styled.label`
    display: flex;
    gap: 0.45rem;
    align-items: baseline;
    margin-top: 0.2rem;
    color: var(--colour-muted);

    &[data-done="true"] {
        color: var(--colour-ok);
    }

    input {
        margin: 0;
        accent-color: var(--colour-ok);
    }
`;

const Actions = styled.div`
    display: flex;
    gap: 0.4rem;
    justify-content: flex-end;
    margin-top: 0.6rem;

    > :first-child {
        margin-right: auto;
    }
`;

const Ring = styled.div`
    position: fixed;
    z-index: 19;
    border: 2px solid var(--colour-primary);
    border-radius: 6px;
    box-shadow: 0 0 0 4px rgb(0 0 0 / 25%);
    pointer-events: none;
`;

interface Box {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
}

/** The first of `selectors` on screen, as its box, or null. */
function showing(selectors: readonly string[]): Box | null {
    for (const selector of selectors) {
        for (const element of document.querySelectorAll(selector)) {
            const box = element.getBoundingClientRect();
            if (box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < window.innerHeight) {
                return { left: box.left, top: box.top, width: box.width, height: box.height };
            }
        }
    }
    return null;
}

const same = (a: Box | null, b: Box | null): boolean =>
    a === b || (a !== null && b !== null && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height);

/** Where the callout goes: beside its target, on whichever side has room, or at the foot of the view with none. */
function placed(target: Box | null, height: number): { left: number; top: number } {
    const clampTop = (top: number): number => Math.max(MARGIN, Math.min(top, window.innerHeight - height - MARGIN));
    const clampLeft = (left: number): number => Math.max(MARGIN, Math.min(left, window.innerWidth - WIDTH - MARGIN));
    if (target === null) return { left: clampLeft((window.innerWidth - WIDTH) / 2), top: window.innerHeight - height - 4 * MARGIN };
    const right = target.left + target.width + GAP;
    if (right + WIDTH <= window.innerWidth - MARGIN) return { left: right, top: clampTop(target.top) };
    const left = target.left - GAP - WIDTH;
    if (left >= MARGIN) return { left, top: clampTop(target.top) };
    const below = target.top + target.height + GAP;
    if (below + height <= window.innerHeight - MARGIN) return { left: clampLeft(target.left), top: below };
    return { left: clampLeft(target.left), top: clampTop(target.top - GAP - height) };
}

/**
 * A step-by-step tour that points at what each step is about, beside the page
 * rather than over it, so the player does each thing as it asks. Its goal is
 * ticked off as it comes true and unticked if it stops, and the player goes on
 * when they are ready: Next once it is done, Skip before, so a goal met while
 * reading, or by playing about ahead of the tour, takes nothing away.
 */
export function Tour({ id, steps, at, onAt, onEnd }: TourProps) {
    const step = steps[at];
    const callout = useRef<HTMLElement>(null);
    const [target, setTarget] = useState<Box | null>(null);
    const [side, setSide] = useState<Box | null>(null);
    const [height, setHeight] = useState(0);
    const done = step?.goal === undefined || step.goal.done;

    // Followed every frame: the target moves with the layout, folds and the canvas, and nothing says when.
    useLayoutEffect(() => {
        if (step === undefined) return;
        let frame = 0;
        let last: Box | null | undefined;
        let lastSide: Box | null | undefined;
        const follow = (): void => {
            const now = showing(step.targets ?? []);
            if (last === undefined || !same(now, last)) {
                last = now;
                setTarget(now);
            }
            const region = step.beside === undefined ? null : showing([step.beside]);
            if (lastSide === undefined || !same(region, lastSide)) {
                lastSide = region;
                setSide(region);
            }
            const tall = callout.current?.offsetHeight ?? 0;
            setHeight((was) => (was === tall ? was : tall));
            frame = requestAnimationFrame(follow);
        };
        follow();
        return () => cancelAnimationFrame(frame);
    }, [step]);

    if (step === undefined) return null;
    const last = at === steps.length - 1;
    const where =
        target === null && side !== null
            ? { left: side.left + side.width + GAP, top: window.innerHeight - height - 4 * MARGIN }
            : placed(target === null || side === null ? target : { ...side, top: target.top, height: target.height }, height);
    return (
        <>
            {target !== null && (
                <Ring
                    id={`${id}Ring`}
                    style={{ left: target.left - 4, top: target.top - 4, width: target.width + 8, height: target.height + 8 }}
                />
            )}
            <Callout
                ref={callout}
                id={id}
                role="dialog"
                aria-labelledby={`${id}Title`}
                data-step={step.id}
                style={{ left: where.left, top: where.top }}
            >
                <Count>{`Step ${at + 1} of ${steps.length}`}</Count>
                <h2 id={`${id}Title`}>{step.title}</h2>
                {step.body}
                {step.goal !== undefined && (
                    <Goal data-done={step.goal.done}>
                        <input id={`${id}Goal`} type="checkbox" checked={step.goal.done} readOnly tabIndex={-1} />
                        {step.goal.label}
                    </Goal>
                )}
                <Actions>
                    <Button id={`${id}End`} variant="plain" title="End the tutorial" onClick={onEnd}>
                        End
                    </Button>
                    <Button id={`${id}Back`} disabled={at === 0} onClick={() => onAt(at - 1)}>
                        Back
                    </Button>
                    <Button
                        id={`${id}Next`}
                        variant={done ? "primary" : "plain"}
                        {...(done ? {} : { title: "On to the next step without doing this one" })}
                        onClick={() => (last ? onEnd() : onAt(at + 1))}
                    >
                        {done ? (last ? "Finish" : "Next") : "Skip"}
                    </Button>
                </Actions>
            </Callout>
        </>
    );
}
