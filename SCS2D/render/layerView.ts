import type { Snapshot } from "../sim/index.js";
import type { Camera } from "./camera.js";
import type { Light } from "./light.js";
import { pixiView } from "./pixiView.js";
import { threeView } from "./three/threeView.js";

/**
 * What draws a battle on a canvas of its own: Pixi (render/pixiView.ts) or
 * three.js (render/three/threeView.ts), chosen by `rendererChoice`. Both hand
 * back a context canvas2d.ts draws the rest of the frame into, as a canvas.
 */
export interface LayerView {
    readonly ready: boolean;
    readonly failed: boolean;
    readonly canvas: HTMLCanvasElement;
    readonly started: Promise<boolean>;
    begin(snapshot: Snapshot, camera: Camera, widthPx: number, heightPx: number, light?: Light): CanvasRenderingContext2D | null;
    end(): void;
    dispose(): void;
}

/** Which renderer draws the battle. */
export type RendererChoice = "pixi" | "three";

export const RENDERER_CHOICES: readonly { readonly value: RendererChoice; readonly label: string }[] = [
    { value: "pixi", label: "Pixi" },
    { value: "three", label: "Three (flat)" },
];

const KEY = "scs2d.renderer";
const EVENT = "scs2d-renderer";

export function rendererChoice(): RendererChoice {
    try {
        const kept = localStorage.getItem(KEY);
        if (RENDERER_CHOICES.some((c) => c.value === kept)) return kept as RendererChoice;
    } catch {
        // Storage may be blocked; the default stands.
    }
    return "pixi";
}

/** Draw every view with `choice` from now on, those already open as well. */
export function setRendererChoice(choice: RendererChoice): void {
    try {
        localStorage.setItem(KEY, choice);
    } catch {
        // Kept for this page only.
    }
    window.dispatchEvent(new CustomEvent(EVENT, { detail: choice }));
}

/** A view drawn with `choice`, on `canvas`. */
export function viewOf(canvas: HTMLCanvasElement, choice: RendererChoice = rendererChoice()): LayerView {
    if (choice === "pixi") return pixiView(canvas) as unknown as LayerView;
    return threeView(canvas);
}

/**
 * A view on a canvas of its own, put under `over`, which stays the one taking
 * input and holds whatever is still drawn in 2D over it. When the renderer is
 * changed, the view is made again with the new one and `onChange` is called
 * once it has started, to draw it.
 */
export function layerUnder(over: HTMLCanvasElement): {
    readonly view: LayerView;
    readonly canvas: HTMLCanvasElement;
    onChange(redraw: () => void): void;
    remove(): void;
} {
    const make = (choice: RendererChoice): { view: LayerView; canvas: HTMLCanvasElement } => {
        const canvas = document.createElement("canvas");
        canvas.setAttribute("aria-hidden", "true");
        Object.assign(canvas.style, { position: "absolute", inset: "0", width: "100%", height: "100%", pointerEvents: "none" });
        canvas.width = over.width;
        canvas.height = over.height;
        over.style.position = "relative";
        over.before(canvas);
        return { view: viewOf(canvas, choice), canvas };
    };
    let made = make(rendererChoice());
    const redraws: (() => void)[] = [];
    const swap = (event: Event): void => {
        const choice = (event as CustomEvent<RendererChoice>).detail;
        made.view.dispose();
        made.canvas.remove();
        made = make(choice);
        void made.view.started.then((started) => {
            if (started) for (const redraw of redraws) redraw();
        });
    };
    window.addEventListener(EVENT, swap);
    const view: LayerView = {
        get ready() {
            return made.view.ready;
        },
        get failed() {
            return made.view.failed;
        },
        get canvas() {
            return made.canvas;
        },
        get started() {
            return made.view.started;
        },
        begin: (...args) => made.view.begin(...args),
        end: () => made.view.end(),
        dispose: () => made.view.dispose(),
    };
    return {
        view,
        get canvas() {
            return made.canvas;
        },
        onChange(redraw) {
            redraws.push(redraw);
        },
        remove() {
            window.removeEventListener(EVENT, swap);
            made.view.dispose();
            made.canvas.remove();
        },
    };
}

/** Listen for the renderer being changed, until the returned function is called. */
export function onRendererChange(listener: (choice: RendererChoice) => void): () => void {
    const handle = (event: Event): void => listener((event as CustomEvent<RendererChoice>).detail);
    window.addEventListener(EVENT, handle);
    return () => window.removeEventListener(EVENT, handle);
}
