import { styled } from "@linaria/react";
import { useEffect, useEffectEvent, useRef, type ReactNode } from "react";
import { battleView, type BattleView } from "~/host/battleView";
import type { Battle } from "~/scenarios/types";
import type { Snapshot } from "~/sim/index";

const Stage = styled.div`
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
`;

const Canvas = styled.canvas`
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
    cursor: grab;

    &:active {
        cursor: grabbing;
    }
`;

export interface BattleCanvasProps {
    /** The view once it exists, and null once it is gone. */
    readonly onView: (view: BattleView | null) => void;
    /** Every frame: keep what it says in a ref, never in state (DESIGN.md non-negotiable 5). */
    readonly onDrawn?: (shown: Snapshot) => void;
    readonly onRunningChanged?: (running: boolean) => void;
    readonly onRewound?: (battle: Battle) => void;
    /** Drawn over the battle, placed absolutely within it. */
    readonly children?: ReactNode;
}

/**
 * A battle drawn and run on the wall clock: a canvas React mounts and then
 * leaves to `battleView`, which owns the clock, the camera and the input.
 */
export function BattleCanvas({ onView, onDrawn, onRunningChanged, onRewound, children }: BattleCanvasProps) {
    const canvas = useRef<HTMLCanvasElement>(null);
    const created = useEffectEvent((view: BattleView | null) => onView(view));
    const drawn = useEffectEvent((shown: Snapshot) => onDrawn?.(shown));
    const runningChanged = useEffectEvent((running: boolean) => onRunningChanged?.(running));
    const rewound = useEffectEvent((battle: Battle) => onRewound?.(battle));

    useEffect(() => {
        const view = battleView(canvas.current!, () => {}, drawn, runningChanged, rewound);
        created(view);
        return () => {
            view.dispose();
            created(null);
        };
    }, []);

    return (
        <Stage>
            <Canvas ref={canvas} aria-label="Battle" />
            {children}
        </Stage>
    );
}
