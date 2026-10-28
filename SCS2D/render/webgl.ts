import type { Snapshot } from "../sim/index.js";
import { BACKGROUND, GRID, gridSegments, Segments, WELL, wellSegments } from "./backdrop.js";
import type { Camera } from "./camera.js";

/**
 * A battle's backdrop drawn with WebGL 2, on a canvas laid under the Canvas2D
 * one, which then draws everything else over it on a clear field.
 *
 * The first piece of the WebGL viewer (ROADMAP.md §8 step 17): what it draws
 * moves here from canvas2d.ts piece by piece, behind the renderer setting,
 * until nothing of the battle is left for Canvas2D.
 */
export interface WebglLayer {
    /** Whether the context is usable: false once lost, until it is restored. */
    readonly ready: boolean;
    draw(snapshot: Snapshot, camera: Camera, widthPx: number, heightPx: number): void;
    dispose(): void;
}

const VERTEX = `#version 300 es
in vec2 position;
uniform vec2 toClip;
void main() {
    gl_Position = vec4(position * toClip, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision mediump float;
uniform vec4 colour;
out vec4 fragColour;
void main() {
    fragColour = colour;
}`;

/** The layer on `canvas`, or null where WebGL 2 is not to be had. */
export function webglLayer(canvas: HTMLCanvasElement): WebglLayer | null {
    const gl = canvas.getContext("webgl2", { antialias: true, alpha: false });
    if (gl === null) return null;

    const segments = new Segments();
    let resources: Resources | null = build(gl);
    let lost = false;

    const onLost = (event: Event): void => {
        // Without this the browser never offers the context back.
        event.preventDefault();
        lost = true;
        resources = null;
    };
    const onRestored = (): void => {
        lost = false;
        resources = build(gl);
    };
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);

    const [br, bg, bb] = rgb(BACKGROUND);
    const grid = rgb(GRID);
    const well = rgb(WELL);

    return {
        get ready() {
            return !lost && resources !== null;
        },
        draw(snapshot, camera, widthPx, heightPx) {
            if (lost || resources === null) return;
            const { program, buffer, vao, toClip, colour } = resources;
            gl.viewport(0, 0, widthPx, heightPx);
            gl.clearColor(br, bg, bb, 1);
            gl.clear(gl.COLOR_BUFFER_BIT);

            gl.useProgram(program);
            gl.bindVertexArray(vao);
            gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
            // Metres from the camera to clip space, y already up in both.
            gl.uniform2f(toClip, (2 * camera.scale) / widthPx, (2 * camera.scale) / heightPx);

            const lines = (fill: (out: Segments) => void, [r, g, b]: readonly number[]): void => {
                segments.clear();
                fill(segments);
                if (segments.count === 0) return;
                gl.bufferData(gl.ARRAY_BUFFER, segments.data, gl.STREAM_DRAW, 0, segments.count * 4);
                gl.uniform4f(colour, r!, g!, b!, 1);
                gl.drawArrays(gl.LINES, 0, segments.count * 2);
            };
            lines((out) => gridSegments(out, camera, widthPx, heightPx), grid);
            lines((out) => wellSegments(out, snapshot, camera), well);
            gl.bindVertexArray(null);
        },
        dispose() {
            canvas.removeEventListener("webglcontextlost", onLost);
            canvas.removeEventListener("webglcontextrestored", onRestored);
            if (resources !== null && !lost) {
                gl.deleteBuffer(resources.buffer);
                gl.deleteVertexArray(resources.vao);
                gl.deleteProgram(resources.program);
            }
            resources = null;
        },
    };
}

interface Resources {
    readonly program: WebGLProgram;
    readonly buffer: WebGLBuffer;
    readonly vao: WebGLVertexArrayObject;
    readonly toClip: WebGLUniformLocation;
    readonly colour: WebGLUniformLocation;
}

/** The program and buffers, made again whenever a lost context is restored. */
function build(gl: WebGL2RenderingContext): Resources | null {
    const program = gl.createProgram();
    const vertex = shader(gl, gl.VERTEX_SHADER, VERTEX);
    const fragment = shader(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    if (vertex === null || fragment === null) return null;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!(gl.getProgramParameter(program, gl.LINK_STATUS) as boolean)) {
        console.error(gl.getProgramInfoLog(program));
        gl.deleteProgram(program);
        return null;
    }

    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const position = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    const toClip = gl.getUniformLocation(program, "toClip");
    const colour = gl.getUniformLocation(program, "colour");
    if (toClip === null || colour === null) return null;
    return { program, buffer, vao, toClip, colour };
}

function shader(gl: WebGL2RenderingContext, type: GLenum, source: string): WebGLShader | null {
    const made = gl.createShader(type);
    if (made === null) return null;
    gl.shaderSource(made, source);
    gl.compileShader(made);
    if (gl.getShaderParameter(made, gl.COMPILE_STATUS) as boolean) return made;
    console.error(gl.getShaderInfoLog(made));
    gl.deleteShader(made);
    return null;
}

/** A `#rrggbb` colour as three channels from 0 to 1. */
export function rgb(hex: string): [number, number, number] {
    const n = Number.parseInt(hex.slice(1, 7), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
