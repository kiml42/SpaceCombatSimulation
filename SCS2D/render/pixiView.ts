import { autoDetectRenderer, Container, Graphics, type Renderer } from "pixi.js";
import type { Snapshot } from "../sim/index.js";
import { BACKGROUND, GRID, gridSegments, Segments, WELL, wellSegments } from "./backdrop.js";
import type { Camera } from "./camera.js";
import { HullLayer } from "./hullLayer.js";
import { PixiCanvas } from "./pixiCanvas.js";

/**
 * The battle drawn with PixiJS, on a canvas under the Canvas2D one, which is
 * left clear. The backdrop and the capital ships' fills are Pixi's own; the
 * rest is canvas2d.ts drawing into `PixiCanvas`, in its true order over them.
 */
export interface PixiView {
    /** Whether the renderer has started. Until it has, Canvas2D still draws everything. */
    readonly ready: boolean;
    /** Whether it could not start, as where WebGL is unavailable. */
    readonly failed: boolean;
    /**
     * Draw the backdrop and the capital ships' fills, and hand back the context
     * the rest of the frame is drawn into, until `end`.
     */
    begin(snapshot: Snapshot, camera: Camera, widthPx: number, heightPx: number): PixiCanvas | null;
    /** Put the frame on screen. */
    end(): void;
    dispose(): void;
}

export function pixiView(canvas: HTMLCanvasElement): PixiView {
    let renderer: Renderer | null = null;
    let failed = false;
    let disposed = false;
    const stage = new Container();
    // World to screen, as canvas2d.ts's drawScene: metres up, y flipped. What
    // it holds is placed relative to the camera, so float32 stays steady far out.
    const world = new Container();
    const backdrop = new Graphics();
    const hulls = new HullLayer();
    world.addChild(backdrop, hulls.container);
    const context = new PixiCanvas();
    stage.addChild(world, context.root);
    const segments = new Segments();

    autoDetectRenderer({
        canvas,
        // Not Pixi's own Canvas2D fallback: without WebGL, ours draws everything.
        preference: ["webgl"],
        background: BACKGROUND,
        antialias: true,
        width: canvas.width,
        height: canvas.height,
        resolution: 1,
        autoDensity: false,
    }).then(
        (started) => {
            if (disposed) started.destroy();
            else renderer = started;
        },
        () => {
            failed = true;
        },
    );

    const stroke = (colour: string): void => {
        const { data, count } = segments;
        for (let i = 0; i < count; i++) {
            const k = i * 4;
            backdrop.moveTo(data[k]!, data[k + 1]!).lineTo(data[k + 2]!, data[k + 3]!);
        }
        backdrop.stroke({ color: colour, pixelLine: true });
    };

    return {
        get ready() {
            return renderer !== null;
        },
        get failed() {
            return failed;
        },
        begin(snapshot, camera, widthPx, heightPx) {
            if (renderer === null) return null;
            if (renderer.width !== widthPx || renderer.height !== heightPx) renderer.resize(widthPx, heightPx);
            world.position.set(widthPx / 2, heightPx / 2);
            world.scale.set(camera.scale, -camera.scale);
            backdrop.clear();
            segments.clear();
            gridSegments(segments, camera, widthPx, heightPx);
            stroke(GRID);
            segments.clear();
            wellSegments(segments, snapshot, camera);
            stroke(WELL);
            hulls.update(snapshot, camera, widthPx, heightPx);
            context.begin();
            return context;
        },
        end() {
            context.end();
            renderer?.render(stage);
        },
        dispose() {
            disposed = true;
            renderer?.destroy();
            renderer = null;
            stage.destroy({ children: true });
        },
    };
}
