import { styled } from "@linaria/react";
import { useEffect, useEffectEvent, useRef, type ReactNode } from "react";
import type { EditorDocument } from "~/editor/document";
import { shipCanvas, type ShipCanvas as Engine, type ShipCanvasHooks } from "~/editor/shipCanvas";

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

export interface ShipCanvasProps extends ShipCanvasHooks {
    readonly doc: EditorDocument;
    /** The engine once it exists, and null once it is gone. */
    readonly onEngine: (engine: Engine | null) => void;
    /** Drawn over the ship, placed absolutely within it. */
    readonly children?: ReactNode;
}

/** The ship drawn, and the pointer and keys on it: a canvas React mounts and leaves to `shipCanvas`. */
export function ShipCanvas({ doc, onEngine, changed, gestureEnded, deleteSelected, zoomed, viewChanged, children }: ShipCanvasProps) {
    const canvas = useRef<HTMLCanvasElement>(null);
    const created = useEffectEvent((engine: Engine | null) => onEngine(engine));
    const onChanged = useEffectEvent(() => changed());
    const onGestureEnded = useEffectEvent(() => gestureEnded());
    const onDelete = useEffectEvent(() => deleteSelected());
    const onZoomed = useEffectEvent(() => zoomed?.());
    const onViewChanged = useEffectEvent(() => viewChanged?.());

    useEffect(() => {
        const engine = shipCanvas(canvas.current!, doc, {
            changed: onChanged,
            gestureEnded: onGestureEnded,
            deleteSelected: onDelete,
            zoomed: onZoomed,
            viewChanged: onViewChanged,
        });
        created(engine);
        return () => {
            engine.dispose();
            created(null);
        };
    }, [doc]);

    return (
        <Stage>
            <Canvas ref={canvas} id="view" aria-label="Ship" />
            {children}
        </Stage>
    );
}
