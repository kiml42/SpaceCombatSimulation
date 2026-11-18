import {
    AddEquation,
    BufferAttribute,
    BufferGeometry,
    CustomBlending,
    GLSL3,
    HalfFloatType,
    Mesh,
    OneFactor,
    OrthographicCamera,
    RawShaderMaterial,
    WebGLRenderTarget,
    type WebGLRenderer,
    Color,
} from "three";
import type { Lights } from "../glows.js";
import { THICK_SHADOW_M } from "../light.js";
import { lightReach, lightTop, LIGHT_HEADROOM } from "../lightField.js";
import { rgba } from "../sprites.js";

/**
 * `LightBuffer`'s twin: each dynamic light drawn as a quad its shader lights
 * the inside of, into a half-float texture at half the canvas's size, once for
 * the deck and once for a thick module's top. What it lights reads it back by
 * where it is on screen (`litMaterial` in threeHulls.ts).
 */

export const LIGHT_RESOLUTION = 0.5;
const CONE_BEHIND = 0.4;
const CONE_NARROWING = 0.85;

const vertex = `
in vec2 aPosition;
in vec4 aEnds;
in vec4 aShape;
in vec4 aColour;
out vec2 vPosition;
out vec4 vEnds;
out vec4 vShape;
out vec4 vColour;
uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(aPosition, 0.0, 1.0);
    vPosition = aPosition;
    vEnds = aEnds;
    vShape = aShape;
    vColour = aColour;
}
`;

const fragment = `
precision highp float;
in vec2 vPosition;
in vec4 vEnds;
in vec4 vShape;
in vec4 vColour;
out vec4 finalColor;
uniform float uSurface;

float falloff(float r) {
    if (r >= 1.0) return 0.0;
    float left = 1.0 - r * r;
    return left * left;
}

void main() {
    vec2 from = vEnds.xy;
    vec2 run = vEnds.zw - from;
    float reach = vShape.x;
    float bottom = vShape.y;
    float top = vColour.a;
    float brightness = vShape.z;
    bool cone = vShape.w > 0.5;
    float lowest = max(uSurface, bottom);
    if (top <= lowest) discard;
    float share = (top - lowest) / (top - bottom);
    float rise = (lowest + top) * 0.5 - uSurface;
    vec2 d = vPosition - from;
    float length2 = dot(run, run);
    float t = length2 > 0.0 ? dot(d, run) / length2 : 0.0;
    float u = clamp(t, 0.0, 1.0);
    vec2 off = d - run * u;
    float distance = sqrt(dot(off, off) + rise * rise);
    float down = distance > 0.0 ? rise / distance : 1.0;
    float strength;
    if (!cone) {
        strength = falloff(distance / reach);
    } else {
        float len = sqrt(length2);
        float side = (d.x * run.y - d.y * run.x) / len;
        float across = sqrt(side * side + rise * rise) / reach;
        float behind = (-t * len) / (reach * ${CONE_BEHIND.toFixed(3)});
        if (t < 0.0) strength = falloff(sqrt(behind * behind + across * across));
        else if (t >= 1.0) strength = 0.0;
        else strength = pow(1.0 - t, 1.5) * falloff(across / (1.0 - ${CONE_NARROWING.toFixed(3)} * t));
    }
    finalColor = vec4(vColour.rgb * brightness * strength * share * down, 0.0);
}
`;

export class ThreeLights {
    readonly deck = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
    readonly thick = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
    private readonly material = new RawShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: { uSurface: { value: 0 } },
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: CustomBlending,
        blendEquation: AddEquation,
        blendSrc: OneFactor,
        blendDst: OneFactor,
    });
    private readonly geometry = new BufferGeometry();
    private readonly mesh = new Mesh(this.geometry, this.material);
    private readonly camera = new OrthographicCamera(0, 1, 0, 1, -1, 1);
    private room = 0;
    private readonly black = new Color(0, 0, 0);

    constructor() {
        this.mesh.frustumCulled = false;
    }

    /** Draw `lights` (canvas pixels) into the buffers: false, drawing nothing, where none lights anything. */
    update(renderer: WebGLRenderer, lights: Lights, widthPx: number, heightPx: number, scale: number, thick: boolean): boolean {
        if (lights.count === 0) return false;
        const width = Math.max(1, Math.ceil(widthPx * LIGHT_RESOLUTION));
        const height = Math.max(1, Math.ceil(heightPx * LIGHT_RESOLUTION));
        for (const target of [this.deck, this.thick]) if (target.width !== width || target.height !== height) target.setSize(width, height);
        if (!this.fill(lights)) return false;
        // Canvas pixels, y down, onto the whole of the buffer.
        this.camera.left = 0;
        this.camera.right = widthPx;
        this.camera.top = 0;
        this.camera.bottom = heightPx;
        this.camera.updateProjectionMatrix();
        const before = renderer.getRenderTarget();
        const clearAlpha = renderer.getClearAlpha();
        const clearColour = new Color();
        renderer.getClearColor(clearColour);
        renderer.setClearColor(this.black, 1);
        const draw = (target: WebGLRenderTarget, surface: number): void => {
            this.material.uniforms.uSurface!.value = surface;
            renderer.setRenderTarget(target);
            renderer.clear(true, false, false);
            renderer.render(this.mesh, this.camera);
        };
        draw(this.deck, 0);
        if (thick) draw(this.thick, THICK_SHADOW_M * scale);
        renderer.setRenderTarget(before);
        renderer.setClearColor(clearColour, clearAlpha);
        return true;
    }

    private fill(lights: Lights): boolean {
        if (lights.count > this.room) this.grow(lights.count);
        const g = this.geometry;
        const position = g.getAttribute("aPosition").array as Float32Array;
        const ends = g.getAttribute("aEnds").array as Float32Array;
        const shape = g.getAttribute("aShape").array as Float32Array;
        const colour = g.getAttribute("aColour").array as Float32Array;
        let n = 0;
        for (let k = 0; k < lights.count; k++) {
            if (lights.lightless[k] === 1) continue;
            let x0 = lights.x0[k]!;
            let y0 = lights.y0[k]!;
            let x1 = lights.x1[k]!;
            let y1 = lights.y1[k]!;
            if ((x1 - x0) ** 2 + (y1 - y0) ** 2 < 1) {
                x0 = x1 = (x0 + x1) / 2;
                y0 = y1 = (y0 + y1) / 2;
            }
            const radius = lights.radius[k]!;
            const reach = radius * lightReach(lights.brightness[k]!);
            const cone = lights.cone[k] === 1 && (x1 !== x0 || y1 !== y0);
            const [r, gr, b] = rgba(lights.colour[k]!);
            const brightness = Math.min(1, lights.brightness[k]! / LIGHT_HEADROOM);
            const left = Math.min(x0, x1) - reach;
            const right = Math.max(x0, x1) + reach;
            const bottom = Math.min(y0, y1) - reach;
            const top = Math.max(y0, y1) + reach;
            const corners = [left, bottom, right, bottom, right, top, left, bottom, right, top, left, top];
            for (let v = 0; v < 6; v++) {
                const i = 6 * n + v;
                position[2 * i] = corners[2 * v]!;
                position[2 * i + 1] = corners[2 * v + 1]!;
                ends.set([x0, y0, x1, y1], 4 * i);
                shape.set([reach, lights.height[k]!, brightness, cone ? 1 : 0], 4 * i);
                colour.set([r / 255, gr / 255, b / 255, lightTop(lights.height[k]!, radius)], 4 * i);
            }
            n++;
        }
        if (n === 0) return false;
        for (const name of ["aPosition", "aEnds", "aShape", "aColour"]) g.getAttribute(name).needsUpdate = true;
        g.setDrawRange(0, 6 * n);
        return true;
    }

    private grow(count: number): void {
        let room = Math.max(64, this.room);
        while (room < count) room *= 2;
        this.room = room;
        const v = 6 * room;
        this.geometry.setAttribute("aPosition", new BufferAttribute(new Float32Array(2 * v), 2));
        this.geometry.setAttribute("aEnds", new BufferAttribute(new Float32Array(4 * v), 4));
        this.geometry.setAttribute("aShape", new BufferAttribute(new Float32Array(4 * v), 4));
        this.geometry.setAttribute("aColour", new BufferAttribute(new Float32Array(4 * v), 4));
    }

    dispose(): void {
        this.deck.dispose();
        this.thick.dispose();
        this.geometry.dispose();
        this.material.dispose();
    }
}
