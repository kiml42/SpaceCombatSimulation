import { Snapshot } from "../sim/index.js";
import { frame, type Camera } from "../render/camera.js";
import { draw } from "../render/canvas2d.js";
import { Flashes } from "../render/flashes.js";
import { DEFAULT_LIGHT, type Light } from "../render/light.js";
import { pixiUnder } from "../render/pixiView.js";
import { EFFECTS_SCENES } from "./effectsScene.js";

/**
 * The Effects route's view: one of `EFFECTS_SCENES` drawn by the battle's
 * renderer, looping on the wall clock at a chosen speed, or held at a moment.
 * React mounts it on a canvas and leaves it alone.
 */
export interface EffectsView {
    /** Seconds into the current scene's loop. */
    readonly time: number;
    readonly loop: number;
    show(scene: number): void;
    setPlaying(playing: boolean): void;
    /** How fast the loop runs beside the wall clock. */
    setSpeed(speed: number): void;
    seek(time: number): void;
    setLight(light: Light): void;
    fit(): void;
    dispose(): void;
}

export function effectsView(canvas: HTMLCanvasElement): EffectsView {
    const stacked = pixiUnder(canvas);
    const camera: Camera = { x: 0, y: 0, scale: 8 };
    const snapshot = new Snapshot();
    const flashes = new Flashes();
    let scene = EFFECTS_SCENES[0]!;
    let time = 0;
    let playing = true;
    let speed = 1;
    let light = DEFAULT_LIGHT;
    let fitting = true;
    let last = 0;
    let disposed = false;
    let drag: { x: number; y: number } | null = null;

    const render = (): void => {
        scene.build(time, snapshot, flashes);
        if (fitting) {
            frame(camera, snapshot, canvas.width, canvas.height, 1);
            fitting = false;
        }
        const pixi = stacked.view.ready ? stacked.view.begin(snapshot, camera, canvas.width, canvas.height, light) : null;
        if (pixi === null) return;
        draw(
            pixi as unknown as CanvasRenderingContext2D,
            snapshot,
            camera,
            canvas.width,
            canvas.height,
            flashes,
            "none",
            false,
            -1,
            [],
            null,
            true,
            light,
        );
        stacked.view.end();
    };

    const tick = (now: number): void => {
        if (disposed) return;
        const dt = last === 0 ? 0 : Math.min((now - last) / 1000, 0.1);
        last = now;
        if (playing) time = (time + dt * speed) % scene.loop;
        render();
        window.requestAnimationFrame(tick);
    };
    window.requestAnimationFrame(tick);

    const resize = (): void => {
        const ratio = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        const width = Math.max(1, Math.round(rect.width * ratio));
        const height = Math.max(1, Math.round(rect.height * ratio));
        for (const each of [canvas, stacked.canvas]) {
            if (each.width !== width) each.width = width;
            if (each.height !== height) each.height = height;
        }
        fitting = true;
    };
    const resized = new ResizeObserver(resize);
    resized.observe(canvas);

    /** Canvas pixels per CSS pixel, for turning a pointer's movement into the camera's. */
    const ratio = (): number => canvas.width / Math.max(1, canvas.getBoundingClientRect().width);
    const worldAt = (event: PointerEvent | WheelEvent): { x: number; y: number } => {
        const rect = canvas.getBoundingClientRect();
        const px = (event.clientX - rect.left) * ratio() - canvas.width / 2;
        const py = (event.clientY - rect.top) * ratio() - canvas.height / 2;
        return { x: camera.x + px / camera.scale, y: camera.y - py / camera.scale };
    };
    const wheel = (event: WheelEvent): void => {
        event.preventDefault();
        const before = worldAt(event);
        camera.scale *= Math.exp(-event.deltaY * 0.0015);
        const after = worldAt(event);
        camera.x += before.x - after.x;
        camera.y += before.y - after.y;
    };
    const down = (event: PointerEvent): void => {
        drag = { x: event.clientX, y: event.clientY };
        canvas.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent): void => {
        if (drag === null) return;
        camera.x -= ((event.clientX - drag.x) * ratio()) / camera.scale;
        camera.y += ((event.clientY - drag.y) * ratio()) / camera.scale;
        drag = { x: event.clientX, y: event.clientY };
    };
    const up = (): void => {
        drag = null;
    };
    canvas.addEventListener("wheel", wheel, { passive: false });
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);

    return {
        get time() {
            return time;
        },
        get loop() {
            return scene.loop;
        },
        show(index) {
            scene = EFFECTS_SCENES[index] ?? scene;
            time = Math.min(time, scene.loop);
            fitting = true;
        },
        setPlaying(on) {
            playing = on;
        },
        setSpeed(value) {
            speed = value;
        },
        seek(value) {
            time = Math.max(0, Math.min(scene.loop, value));
        },
        setLight(value) {
            light = value;
        },
        fit() {
            fitting = true;
        },
        dispose() {
            disposed = true;
            canvas.removeEventListener("wheel", wheel);
            canvas.removeEventListener("pointerdown", down);
            canvas.removeEventListener("pointermove", move);
            canvas.removeEventListener("pointerup", up);
            canvas.removeEventListener("pointercancel", up);
            resized.disconnect();
            stacked.remove();
        },
    };
}
