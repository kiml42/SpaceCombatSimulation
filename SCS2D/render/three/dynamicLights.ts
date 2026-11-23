import { DataTexture, FloatType, RGBAFormat, type Material, type WebGLProgramParametersWithUniforms } from "three";
import type { Lights } from "../glows.js";
import { LIGHT_GAIN, LIGHT_HEADROOM, lightReach, lightTop } from "../lightField.js";
import { rgba } from "../sprites.js";

/**
 * The dynamic lights on the 3D models, as the light buffer (render/lightBuffer.ts)
 * lights Pixi's hulls: every engine, flash, beam and plume, each as far as it
 * reaches and as squarely as it shines on a face, worked out per fragment from
 * a list of the lights in world metres. A face is lit by which way it faces,
 * so the side of a block takes a muzzle flash beside it as Pixi's top does one above.
 */

/** The most lights a frame lights the models with: past it, the brightest are kept. */
const MOST = 256;
/** Texels each light takes: its ends; its reach, bottom, top and brightness; its colour and whether it is a cone. */
const TEXELS = 3;
/** As render/lightField.ts has them. */
const CONE_BEHIND = 0.4;
const CONE_NARROWING = 0.85;

export class DynamicLights {
    private readonly data = new Float32Array(MOST * TEXELS * 4);
    private readonly texture = new DataTexture(this.data, MOST * TEXELS, 1, RGBAFormat, FloatType);
    private readonly uniforms = { uDynLights: { value: this.texture }, uDynCount: { value: 0 } };
    private readonly order: number[] = [];

    /** `lights`, canvas pixels on a canvas `widthPx` by `heightPx` at `scale`, as metres from the camera's point. */
    set(lights: Lights, widthPx: number, heightPx: number, scale: number): void {
        const order = this.order;
        order.length = 0;
        for (let k = 0; k < lights.count; k++) if (lights.lightless[k] !== 1) order.push(k);
        if (order.length > MOST)
            order.sort((p, q) => lights.brightness[q]! * lights.radius[q]! - lights.brightness[p]! * lights.radius[p]!);
        const n = Math.min(MOST, order.length);
        const x = (px: number): number => (px - widthPx / 2) / scale;
        const y = (py: number): number => -(py - heightPx / 2) / scale;
        for (let i = 0; i < n; i++) {
            const k = order[i]!;
            let x0 = lights.x0[k]!;
            let y0 = lights.y0[k]!;
            let x1 = lights.x1[k]!;
            let y1 = lights.y1[k]!;
            // Under a pixel long, a line is a point at its middle, as the light buffer has it.
            if ((x1 - x0) ** 2 + (y1 - y0) ** 2 < 1) {
                x0 = x1 = (x0 + x1) / 2;
                y0 = y1 = (y0 + y1) / 2;
            }
            const radius = lights.radius[k]!;
            const [r, g, b] = rgba(lights.colour[k]!);
            const o = i * TEXELS * 4;
            this.data.set([x(x0), y(y0), x(x1), y(y1)], o);
            this.data.set(
                [
                    (radius * lightReach(lights.brightness[k]!)) / scale,
                    lights.height[k]! / scale,
                    lightTop(lights.height[k]!, radius) / scale,
                    Math.min(1, lights.brightness[k]! / LIGHT_HEADROOM),
                ],
                o + 4,
            );
            this.data.set([r / 255, g / 255, b / 255, lights.cone[k] === 1 && (x0 !== x1 || y0 !== y1) ? 1 : 0], o + 8);
        }
        this.uniforms.uDynCount.value = n;
        this.texture.needsUpdate = true;
    }

    /** Light `material`, a Lambert one, by these lights too. */
    light<T extends Material>(material: T): T {
        material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
            Object.assign(shader.uniforms, this.uniforms);
            shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vDynWorld;").replace(
                "#include <worldpos_vertex>",
                `#include <worldpos_vertex>
    {
        vec4 dynAt = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
            dynAt = instanceMatrix * dynAt;
        #endif
        vDynWorld = (modelMatrix * dynAt).xyz;
    }`,
            );
            shader.fragmentShader = shader.fragmentShader
                .replace("#include <common>", `#include <common>\n${FRAGMENT}`)
                .replace(
                    "#include <opaque_fragment>",
                    "outgoingLight += diffuseColor.rgb * dynLight(vDynWorld, normal);\n#include <opaque_fragment>",
                );
        };
        material.needsUpdate = true;
        return material;
    }

    dispose(): void {
        this.texture.dispose();
    }
}

const FRAGMENT = /* glsl */ `
varying vec3 vDynWorld;
uniform sampler2D uDynLights;
uniform int uDynCount;

float dynFalloff(float r)
{
    if (r >= 1.0) return 0.0;
    float left = 1.0 - r * r;
    return left * left;
}

// The light on a face at p, facing nView in view space, as render/lightBuffer.ts lights a surface facing up.
vec3 dynLight(vec3 p, vec3 nView)
{
    vec3 sum = vec3(0.0);
    for (int k = 0; k < ${MOST}; k++) {
        if (k >= uDynCount) break;
        vec4 ends = texelFetch(uDynLights, ivec2(${TEXELS} * k, 0), 0);
        vec4 shape = texelFetch(uDynLights, ivec2(${TEXELS} * k + 1, 0), 0);
        vec4 colour = texelFetch(uDynLights, ivec2(${TEXELS} * k + 2, 0), 0);
        float reach = shape.x;
        float bottom = shape.y;
        float top = shape.z;
        // As thick as a flame: what is partway up it takes the share above, from that share's middle.
        float lowest = max(p.z, bottom);
        if (top <= lowest) continue;
        float share = (top - lowest) / (top - bottom);
        float rise = (lowest + top) * 0.5 - p.z;
        vec2 from = ends.xy;
        vec2 run = ends.zw - from;
        vec2 d = p.xy - from;
        float length2 = dot(run, run);
        float t = length2 > 0.0 ? dot(d, run) / length2 : 0.0;
        vec2 off = d - run * clamp(t, 0.0, 1.0);
        float distance = sqrt(dot(off, off) + rise * rise);
        float strength;
        if (colour.w < 0.5) {
            strength = dynFalloff(distance / reach);
        } else {
            float len = sqrt(length2);
            float side = (d.x * run.y - d.y * run.x) / len;
            float across = sqrt(side * side + rise * rise) / reach;
            float behind = (-t * len) / (reach * ${CONE_BEHIND.toFixed(3)});
            if (t < 0.0) strength = dynFalloff(sqrt(behind * behind + across * across));
            else if (t >= 1.0) strength = 0.0;
            else strength = pow(1.0 - t, 1.5) * dynFalloff(across / (1.0 - ${CONE_NARROWING.toFixed(3)} * t));
        }
        if (strength <= 0.0) continue;
        // As squarely as it shines on the face: for one facing up, rise / distance, as Pixi has it.
        vec3 toward = distance > 0.0 ? vec3(-off, rise) / distance : vec3(0.0, 0.0, 1.0);
        float facing = max(dot(nView, normalize((viewMatrix * vec4(toward, 0.0)).xyz)), 0.0);
        sum += colour.rgb * shape.w * strength * share * facing;
    }
    return (1.0 - exp(-sum * ${LIGHT_HEADROOM.toFixed(3)})) * ${LIGHT_GAIN.toFixed(3)};
}
`;
