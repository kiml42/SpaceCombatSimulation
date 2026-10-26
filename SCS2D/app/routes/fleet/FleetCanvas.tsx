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

export interface FleetCanvasProps {
    readonly doc: FleetDocument;
    /** The engine once it exists, and null once it is gone. */
    readonly onEngine: (engine: Engine | null) => void;
    /** The canvas changed the fleet, the selection or the zoom. */
    readonly onChanged: () => void;
    /** Escape, before it selects nothing: true if the page took it. */
    readonly onEscape: () => boolean;
}

/** The fleet drawn, and the pointer and keys on it: a canvas React mounts and leaves to `fleetCanvas`. */
export function FleetCanvas({ doc, onEngine, onChanged, onEscape }: FleetCanvasProps) {
    const canvas = useRef<HTMLCanvasElement>(null);
    const created = useEffectEvent((engine: Engine | null) => onEngine(engine));
    const changed = useEffectEvent(() => onChanged());
    const escape = useEffectEvent(() => onEscape());

    useEffect(() => {
        const engine = fleetCanvas(canvas.current!, doc, { changed, escape });
        created(engine);
        return () => {
            engine.dispose();
            created(null);
        };
    }, [doc]);

    return (
        <Stage>
            <Canvas ref={canvas} id="view" aria-label="Fleet" />
        </Stage>
    );
}
