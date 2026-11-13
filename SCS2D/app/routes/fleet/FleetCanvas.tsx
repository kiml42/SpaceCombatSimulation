import { styled } from "@linaria/react";
import { useEffect, useEffectEvent, useRef } from "react";
import { fleetCanvas, type FleetCanvas as Engine } from "~/editor/fleetCanvas";
import type { FleetDocument } from "~/editor/fleetDocument";

const Stage = styled.div`
    position: relative;
    display: flex;
    flex: 1;
    min-width: 0;
    min-height: 0;
`;

const Canvas = styled.canvas`
    display: block;
    flex: 1;
    min-width: 0;
    touch-action: none;
    cursor: crosshair;
`;

/** Just under the fleet's origin, clear of the forward arrow there, and never in the way of the pointer. */
const Hint = styled.p`
    position: absolute;
    top: 50%;
    left: 50%;
    max-width: 80%;
    margin: 0;
    color: var(--colour-muted);
    text-align: center;
    pointer-events: none;
    transform: translate(-50%, 2rem);
`;

export interface FleetCanvasProps {
    readonly doc: FleetDocument;
    /** The engine once it exists, and null once it is gone. */
    readonly onEngine: (engine: Engine | null) => void;
    /** The canvas changed the fleet, the selection or the zoom. */
    readonly onChanged: () => void;
    /** Escape, before it selects nothing: true if the page took it. */
    readonly onEscape: () => boolean;
    /** Said under the fleet's origin, moving with it, as when there is nothing there yet. */
    readonly hint?: string | undefined;
}

/** The fleet drawn, and the pointer and keys on it: a canvas React mounts and leaves to `fleetCanvas`. */
export function FleetCanvas({ doc, onEngine, onChanged, onEscape, hint }: FleetCanvasProps) {
    const canvas = useRef<HTMLCanvasElement>(null);
    const created = useEffectEvent((engine: Engine | null) => onEngine(engine));
    const changed = useEffectEvent(() => onChanged());
    const escape = useEffectEvent(() => onEscape());
    const hinted = useRef<HTMLParagraphElement>(null);
    // Set straight on the element as the view moves, so a pan does not render the page.
    const drawn = (origin: { x: number; y: number }): void => {
        const element = hinted.current;
        if (element === null) return;
        element.style.left = `${origin.x * 100}%`;
        element.style.top = `${origin.y * 100}%`;
    };

    useEffect(() => {
        const engine = fleetCanvas(canvas.current!, doc, { changed, escape, drawn });
        created(engine);
        return () => {
            engine.dispose();
            created(null);
        };
    }, [doc]);

    return (
        <Stage>
            <Canvas ref={canvas} id="view" aria-label="Fleet" />
            {hint !== undefined && (
                <Hint ref={hinted} id="canvasHint">
                    {hint}
                </Hint>
            )}
        </Stage>
    );
}
