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
    PerspectiveCamera,
    Vector3,
    WebGLRenderer,
    type Camera as ThreeCamera,
} from "three";
import { DECK_HEIGHT, type Snapshot } from "../../sim/index.js";
import { BACKGROUND, GRID, gridSegments, Segments, WELL, wellSegments } from "../backdrop.js";
import type { Camera } from "../camera.js";
import type { Light } from "../light.js";
import { seenLights } from "../canvas2d.js";
import { LIGHT_GAIN, LIGHT_HEADROOM } from "../lightField.js";
import type { LayerView, Projection } from "../layerView.js";
import { BatchMeshes, pixelsToMetres, ThreeCanvas, type Box } from "./threeCanvas.js";
import { ThreeHulls } from "./threeHulls.js";
import { ThreeLights } from "./threeLights.js";
import { Ships3D, type DeckBox, type Depths } from "./ships3d.js";
import type { ViewAngle } from "./viewAngle.js";

// Colours as they are given, as Pixi and a Canvas2D take them: no conversion to linear and back.
ColorManagement.enabled = false;

/**
 * The battle drawn with three.js, as `pixiView` draws it with Pixi: the
 * backdrop and the capital ships' fills are three.js's own (`ThreeHulls`), and
 * the rest is canvas2d.ts drawing into `ThreeCanvas`, in its true order over
 * them. Everything is placed in metres from the camera, y up, and seen through
 * an orthographic camera straight down.
 *
 * With `depths`, ships are solid models instead (`Ships3D`), seen in
 * perspective from the angle `angle` gives each frame, and canvas2d.ts draws
 * only what is over them, flat on the ship plane.
 */
export function threeView(canvas: HTMLCanvasElement, depths: Depths | null = null, angle: () => ViewAngle = () => FLAT): LayerView {
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
    const orbiting = new PerspectiveCamera();
    /** For working out where a point on the canvas is, apart from the one drawn with. */
    const asking = new PerspectiveCamera();
    let eye: ThreeCamera = camera;
    const context = new ThreeCanvas();
    context.solidShips = depths !== null;
    const ships = depths !== null && renderer !== null ? new Ships3D(renderer) : null;
    const screen = new Group();
    screen.matrixAutoUpdate = false;
    const screenMeshes = new BatchMeshes();
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
            eye = ships === null ? camera : look(orbiting, angle(), widthPx / 2 / scale, heightPx / 2 / scale);
            // What of the deck is in view, metres from the camera's point: tilted, more than the 2D view's box.
            const seen =
                ships === null
                    ? { minX: -widthPx / 2 / scale, maxX: widthPx / 2 / scale, minY: -heightPx / 2 / scale, maxY: heightPx / 2 / scale }
                    : deckSeen(deckProjection(orbiting, widthPx, heightPx), widthPx, heightPx, Math.max(widthPx, heightPx) / scale);
            segments.clear();
            // The grid over all of it, laid as the 2D view's would be over a view that size.
            const middle = { x: view.x + (seen.minX + seen.maxX) / 2, y: view.y + (seen.minY + seen.maxY) / 2, scale };
            gridSegments(segments, middle, (seen.maxX - seen.minX) * scale, (seen.maxY - seen.minY) * scale);
            for (let k = 0; k < segments.count * 4; k += 2) {
                segments.data[k] = segments.data[k]! + middle.x - view.x;
                segments.data[k + 1] = segments.data[k + 1]! + middle.y - view.y;
            }
            grid.set(segments);
            segments.clear();
            wellSegments(segments, snapshot, view);
            wells.set(segments);
            if (ships !== null && depths !== null) ships.update(snapshot, view, seen, depths, light);
            else hulls.update(snapshot, view, widthPx, heightPx, light);
            context.begin();
            return context as unknown as CanvasRenderingContext2D;
        },
        end() {
            context.end();
            if (renderer === null) return;
            const toMetres = pixelsToMetres(new Matrix4(), size.width, size.height, scale);
            for (const group of [root, deck, screen]) {
                group.clear();
                // In 3D, what is drawn flat lies on the deck's top, where what is drawn on a hull belongs.
                group.matrix.copy(
                    group === root && ships !== null ? pixelsToMetres(new Matrix4(), size.width, size.height, scale, DECK_TOP) : toMetres,
                );
                group.matrixWorldNeedsUpdate = true;
            }
            rootMeshes.begin();
            deckMeshes.begin();
            screenMeshes.begin();
            context.batches.forEach((batch, k) =>
                batch.screen ? screenMeshes.add(batch, screen, k, scissor) : rootMeshes.add(batch, root, k, scissor),
            );
            context.deckBatches.forEach((batch, k) => deckMeshes.add(batch, deck, k, scissor));
            if (ships !== null) {
                ships.shed(seenLights, size.width, size.height, scale);
                renderer.setRenderTarget(null);
                renderer.clear(true, true, true);
                draw(grid.lines, eye);
                draw(wells.lines, eye);
                draw(deck, eye);
                renderer.render(ships.scene, eye);
                draw(root, eye);
                draw(screen);
                return;
            }
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
            draw(screen);
        },
        projection(view: Camera, widthPx: number, heightPx: number) {
            if (ships === null) return null;
            return deckProjection(look(asking, angle(), widthPx / 2 / view.scale, heightPx / 2 / view.scale), widthPx, heightPx);
        },
        dispose() {
            lights.dispose();
            ships?.dispose();
            renderer?.dispose();
            renderer = null;
        },
    };
}

/**
 * The camera for the 3D view, `halfW` by `halfH` metres either side of the
 * middle of the deck: swung round the point the 2D camera is on, `tilt` from
 * straight down, far enough off that at no tilt the deck fills the view as
 * the 2D view's does.
 */
function look(eye: PerspectiveCamera, at: ViewAngle, halfW: number, halfH: number): PerspectiveCamera {
    const fov = (Math.max(5, Math.min(120, at.fov)) * Math.PI) / 180;
    const tilt = (at.tilt * Math.PI) / 180;
    const turn = (at.turn * Math.PI) / 180;
    const distance = halfH / Math.tan(fov / 2);
    eye.fov = (fov * 180) / Math.PI;
    eye.aspect = halfW / halfH;
    eye.near = distance * 0.02;
    eye.far = distance * 20;
    eye.updateProjectionMatrix();
    eye.position.set(
        distance * Math.sin(tilt) * Math.sin(turn),
        -distance * Math.sin(tilt) * Math.cos(turn),
        DECK_TOP + distance * Math.cos(tilt),
    );
    // Up the screen is away from the eye, so at no tilt north is up, as in 2D.
    eye.up.set(-Math.sin(turn), Math.cos(turn), 0);
    eye.lookAt(0, 0, DECK_TOP);
    eye.updateMatrixWorld();
    return eye;
}

/**
 * Where on the deck's top a point `px`, `py` canvas pixels from the middle of
 * a `widthPx` by `heightPx` view is, metres from the camera's point, and back:
 * what a click on the 3D view lands on. A point above the horizon is taken as
 * far off along it.
 */
export function deckProjection(eye: PerspectiveCamera, widthPx: number, heightPx: number): Projection {
    const ray = new Vector3();
    const point = new Vector3();
    return {
        toWorld(px, py) {
            ray.set(px / (widthPx / 2), -py / (heightPx / 2), 0.5)
                .unproject(eye)
                .sub(eye.position)
                .normalize();
            const t = ray.z < -1e-3 ? (DECK_TOP - eye.position.z) / ray.z : eye.far;
            return { x: eye.position.x + ray.x * t, y: eye.position.y + ray.y * t };
        },
        toCanvas(x, y) {
            point.set(x, y, DECK_TOP).project(eye);
            return { px: (point.x * widthPx) / 2, py: (-point.y * heightPx) / 2 };
        },
    };
}

/** The box on the deck the corners of the view land in, metres from the camera's point, out to `most` either way. */
function deckSeen(projection: Projection, widthPx: number, heightPx: number, most: number): DeckBox {
    const box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    for (const [px, py] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
    ] as const) {
        const at = projection.toWorld((px * widthPx) / 2, (py * heightPx) / 2);
        const x = Math.max(-most, Math.min(most, at.x));
        const y = Math.max(-most, Math.min(most, at.y));
        box.minX = Math.min(box.minX, x);
        box.maxX = Math.max(box.maxX, x);
        box.minY = Math.min(box.minY, y);
        box.maxY = Math.max(box.maxY, y);
    }
    return box;
}

/** The top of the thin hull, which the 3D view's flat drawing lies on and its sheared camera keeps where the 2D view has it. */
const DECK_TOP = DECK_HEIGHT / 2;

const FLAT: ViewAngle = { tilt: 0, turn: 0, fov: 50 };

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
