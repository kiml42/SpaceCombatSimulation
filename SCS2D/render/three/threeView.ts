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
    Camera as BareCamera,
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
import type { LayerView } from "../layerView.js";
import { BatchMeshes, pixelsToMetres, ThreeCanvas, type Box } from "./threeCanvas.js";
import { ThreeHulls } from "./threeHulls.js";
import { ThreeLights } from "./threeLights.js";
import { Ships3D, type Depths } from "./ships3d.js";
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
    const sheared = new BareCamera();
    const orbiting = new PerspectiveCamera();
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
            eye = ships === null ? camera : look(sheared, orbiting, angle(), widthPx / 2 / scale, heightPx / 2 / scale);
            segments.clear();
            gridSegments(segments, view, widthPx, heightPx);
            grid.set(segments);
            segments.clear();
            wellSegments(segments, snapshot, view);
            wells.set(segments);
            if (ships !== null && depths !== null) ships.update(snapshot, view, widthPx / 2 / scale, heightPx / 2 / scale, depths, light);
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
                k < context.screenFrom ? rootMeshes.add(batch, root, k, scissor) : screenMeshes.add(batch, screen, k, scissor),
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
        dispose() {
            lights.dispose();
            ships?.dispose();
            renderer?.dispose();
            renderer = null;
        },
    };
}

/** The camera for the 3D view, `halfW` by `halfH` metres either side of the middle of the plane. */
function look(sheared: BareCamera, orbiting: PerspectiveCamera, at: ViewAngle, halfW: number, halfH: number): ThreeCamera {
    const fov = (Math.max(5, Math.min(120, at.fov)) * Math.PI) / 180;
    const tilt = (at.tilt * Math.PI) / 180;
    const turn = (at.turn * Math.PI) / 180;
    // Far enough off that the plane fills the lens top to bottom.
    const distance = halfH / Math.tan(fov / 2);
    const near = distance * 0.02;
    const far = distance * 6;
    if (!at.orbit) {
        // The eye moved off to the side, and the frustum sheared back over the same window on the plane.
        const off = distance * Math.tan(tilt);
        const ex = off * Math.sin(turn);
        const ey = -off * Math.cos(turn);
        sheared.position.set(ex, ey, DECK_TOP + distance);
        sheared.updateMatrixWorld();
        const k = near / distance;
        sheared.projectionMatrix.makePerspective((-halfW - ex) * k, (halfW - ex) * k, (halfH - ey) * k, (-halfH - ey) * k, near, far);
        sheared.projectionMatrixInverse.copy(sheared.projectionMatrix).invert();
        return sheared;
    }
    orbiting.fov = (fov * 180) / Math.PI;
    orbiting.aspect = halfW / halfH;
    orbiting.near = near;
    orbiting.far = far;
    orbiting.updateProjectionMatrix();
    orbiting.position.set(
        distance * Math.sin(tilt) * Math.sin(turn),
        -distance * Math.sin(tilt) * Math.cos(turn),
        DECK_TOP + distance * Math.cos(tilt),
    );
    orbiting.up.set(-Math.sin(turn), Math.cos(turn), 0);
    orbiting.lookAt(new Vector3(0, 0, DECK_TOP));
    orbiting.updateMatrixWorld();
    return orbiting;
}

/** The top of the thin hull, which the 3D view's flat drawing lies on and its sheared camera keeps where the 2D view has it. */
const DECK_TOP = DECK_HEIGHT / 2;

const FLAT: ViewAngle = { tilt: 0, turn: 0, fov: 50, orbit: false };

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
