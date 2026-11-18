import {
    BufferAttribute,
    BufferGeometry,
    ColorManagement,
    Group,
    LinearSRGBColorSpace,
    LineBasicMaterial,
    LineSegments,
    Matrix4,
    type Object3D,
    OrthographicCamera,
    WebGLRenderer,
    type Camera as ThreeCamera,
} from "three";
import type { Snapshot } from "../../sim/index.js";
import { BACKGROUND, GRID, gridSegments, Segments, WELL, wellSegments } from "../backdrop.js";
import type { Camera } from "../camera.js";
import type { Light } from "../light.js";
import { seenLights } from "../canvas2d.js";
import { LIGHT_GAIN, LIGHT_HEADROOM } from "../lightField.js";
import type { LayerView } from "../layerView.js";
import { BatchMeshes, pixelsToMetres, ThreeCanvas, type Box } from "./threeCanvas.js";
import { ThreeHulls } from "./threeHulls.js";
import { ThreeLights } from "./threeLights.js";

// Colours as they are given, as Pixi and a Canvas2D take them: no conversion to linear and back.
ColorManagement.enabled = false;

/**
 * The battle drawn with three.js, as `pixiView` draws it with Pixi: the
 * backdrop and the capital ships' fills are three.js's own (`ThreeHulls`), and
 * the rest is canvas2d.ts drawing into `ThreeCanvas`, in its true order over
 * them. Everything is placed in metres from the camera, y up, and seen through
 * an orthographic camera straight down.
 */
export function threeView(canvas: HTMLCanvasElement): LayerView {
    let renderer: WebGLRenderer | null = null;
    let failed = false;
    try {
        renderer = new WebGLRenderer({ canvas, antialias: true, stencil: true, alpha: false, powerPreference: "high-performance" });
        renderer.outputColorSpace = LinearSRGBColorSpace;
        renderer.autoClear = false;
        renderer.setPixelRatio(1);
        renderer.setClearColor(BACKGROUND, 1);
    } catch {
        failed = true;
    }
    const camera = new OrthographicCamera(-1, 1, 1, -1, -1000, 1000);
    const context = new ThreeCanvas();
    const hulls = new ThreeHulls();
    hulls.lighting = renderer !== null;
    const lights = new ThreeLights();
    const root = new Group();
    const deck = new Group();
    for (const group of [root, deck]) group.matrixAutoUpdate = false;
    const rootMeshes = new BatchMeshes();
    const deckMeshes = new BatchMeshes();
    const segments = new Segments();
    const grid = lineLayer(GRID);
    const wells = lineLayer(WELL);
    let size = { width: 0, height: 0 };
    let scale = 1;

    const scissor = (box: Box | null, r: WebGLRenderer): void => {
        if (box === null) {
            r.setScissorTest(false);
            return;
        }
        r.setScissorTest(true);
        r.setScissor(box.x, size.height - box.y - box.height, box.width, box.height);
    };

    const draw = (object: Object3D, eye: ThreeCamera = camera): void => {
        renderer!.render(object, eye);
    };

    return {
        get ready() {
            return renderer !== null;
        },
        get failed() {
            return failed;
        },
        canvas,
        started: Promise.resolve(!failed),
        begin(snapshot: Snapshot, view: Camera, widthPx: number, heightPx: number, light?: Light) {
            if (renderer === null) return null;
            // Others may size the canvas itself, which leaves the renderer's viewport as it was.
            if (size.width !== widthPx || size.height !== heightPx || canvas.width !== widthPx || canvas.height !== heightPx) {
                renderer.setSize(widthPx, heightPx, false);
            }
            size = { width: widthPx, height: heightPx };
            scale = view.scale;
            camera.left = -widthPx / 2 / scale;
            camera.right = widthPx / 2 / scale;
            camera.top = heightPx / 2 / scale;
            camera.bottom = -heightPx / 2 / scale;
            camera.updateProjectionMatrix();
            segments.clear();
            gridSegments(segments, view, widthPx, heightPx);
            grid.set(segments);
            segments.clear();
            wellSegments(segments, snapshot, view);
            wells.set(segments);
            hulls.update(snapshot, view, widthPx, heightPx, light);
            context.begin();
            return context as unknown as CanvasRenderingContext2D;
        },
        end() {
            context.end();
            if (renderer === null) return;
            const toMetres = pixelsToMetres(new Matrix4(), size.width, size.height, scale);
            for (const group of [root, deck]) {
                group.clear();
                group.matrix.copy(toMetres);
                group.matrixWorldNeedsUpdate = true;
            }
            rootMeshes.begin();
            deckMeshes.begin();
            context.batches.forEach((batch, k) => rootMeshes.add(batch, root, k, scissor));
            context.deckBatches.forEach((batch, k) => deckMeshes.add(batch, deck, k, scissor));
            const lit = lights.update(renderer, seenLights, size.width, size.height, scale, hulls.litThickCount > 0);
            for (const material of [hulls.deckLit, hulls.thickLit]) {
                material.uniforms.uScreen!.value = [size.width, size.height];
                material.uniforms.uGain!.value = LIGHT_GAIN;
                material.uniforms.uHeadroom!.value = LIGHT_HEADROOM;
            }
            hulls.deckLit.uniforms.uLight!.value = lights.deck.texture;
            hulls.thickLit.uniforms.uLight!.value = lights.thick.texture;
            renderer.setRenderTarget(null);
            renderer.clear(true, true, true);
            draw(grid.lines);
            draw(wells.lines);
            for (const pass of hulls.passes) {
                if ("clearStencil" in pass) renderer.clearStencil();
                else if ("deck" in pass) draw(deck);
                else if ("lit" in pass) {
                    if (lit) draw(pass.draw);
                } else draw(pass.draw);
            }
            draw(root);
        },
        dispose() {
            lights.dispose();
            renderer?.dispose();
            renderer = null;
        },
    };
}

/** Lines a pixel wide, as Pixi's `pixelLine` strokes are: what WebGL draws a line as. */
function lineLayer(colour: string): { lines: LineSegments; set(segments: Segments): void } {
    const geometry = new BufferGeometry();
    const lines = new LineSegments(geometry, new LineBasicMaterial({ color: colour, depthTest: false, depthWrite: false }));
    lines.frustumCulled = false;
    let room = 0;
    return {
        lines,
        set(segments) {
            const n = segments.count;
            if (n > room) {
                room = Math.max(64, n * 2);
                geometry.setAttribute("position", new BufferAttribute(new Float32Array(room * 6), 3));
            }
            const position = geometry.getAttribute("position") as BufferAttribute | undefined;
            if (position === undefined) return;
            const out = position.array as Float32Array;
            const data = segments.data;
            for (let i = 0; i < n; i++) {
                out[6 * i] = data[4 * i]!;
                out[6 * i + 1] = data[4 * i + 1]!;
                out[6 * i + 2] = 0;
                out[6 * i + 3] = data[4 * i + 2]!;
                out[6 * i + 4] = data[4 * i + 3]!;
                out[6 * i + 5] = 0;
            }
            position.needsUpdate = true;
            geometry.setDrawRange(0, 2 * n);
        },
    };
}
