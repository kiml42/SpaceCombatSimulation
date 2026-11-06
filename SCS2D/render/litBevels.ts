import { Geometry, GlProgram, Mesh, Shader, UniformGroup, type RenderTexture } from "pixi.js";
import { BEVEL_SLOPE, BEVEL_QUAD_STRIDE, CHROMA_FLOOR, FACING_GLSL } from "./bevelLighting.js";
import { LIGHT_GAIN, LIGHT_HEADROOM } from "./lightField.js";

/**
 * Bevels lit by the dynamic lights from the side they face: a bevel turned
 * towards a light beside the ship catches more of it than the deck does, as
 * one turned to the battle's light is drawn lighter. Added over what the lit
 * hull already has, from the buffers `render/lightBuffer.ts` draws: how much
 * light falls where, and which way across the surface it comes from.
 *
 * A bevel only gains: one turned from a light is lit as the hull under it is.
 */

const vertex = `
in vec2 aPosition;
in vec2 aNormal;
in vec3 aAlbedo;
out vec2 vScreen;
out vec2 vNormal;
out vec3 vAlbedo;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec2 uScreen;

void main(void)
{
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    vec3 clip = mvp * vec3(aPosition, 1.0);
    gl_Position = vec4(clip.xy, 0.0, 1.0);
    // Where on the canvas, from its top left, for the light there.
    vScreen = vec2(clip.x * 0.5 + 0.5, 0.5 - clip.y * 0.5);
    // Which way it faces across the canvas, in its pixels, down being +y, as the light's directions are.
    vec2 facing = (mvp * vec3(aNormal, 0.0)).xy * vec2(uScreen.x, -uScreen.y);
    vNormal = facing / max(length(facing), 1e-6);
    vAlbedo = aAlbedo;
}
`;

const fragment = `
in vec2 vScreen;
in vec2 vNormal;
in vec3 vAlbedo;
out vec4 finalColor;

uniform sampler2D uLight;
uniform sampler2D uDirection;
uniform float uGain;
uniform float uHeadroom;
uniform float uSlope;
${FACING_GLSL}
void main()
{
    vec3 light = texture(uLight, vScreen).rgb;
    float luminance = dot(light, vec3(0.2126, 0.7152, 0.0722));
    // How much more it takes for facing the light across the deck, in the light's own colour.
    float faced = facing(texture(uDirection, vScreen), vNormal) * uSlope;
    // Faint light is taken as white rather than its rounding as a colour.
    vec3 colour = (light + ${CHROMA_FLOOR.toFixed(3)}) / (luminance + ${CHROMA_FLOOR.toFixed(3)});
    vec3 gained = 1.0 - exp(-colour * faced * uHeadroom);
    finalColor = vec4(vAlbedo * gained * uGain, 0.0);
}
`;

export class LitBevels {
    readonly mesh: Mesh<Geometry, Shader>;
    private readonly uniforms = new UniformGroup({
        uScreen: { value: new Float32Array([1, 1]), type: "vec2<f32>" },
        uGain: { value: LIGHT_GAIN, type: "f32" },
        uHeadroom: { value: LIGHT_HEADROOM, type: "f32" },
        uSlope: { value: BEVEL_SLOPE, type: "f32" },
    });
    /** How many quads the geometry has room for. */
    private room = 0;

    /** Lit by `light`, coming from `direction`: the deck's, or a thick module's top's. */
    constructor(light: RenderTexture, direction: RenderTexture) {
        const shader = new Shader({
            glProgram: GlProgram.from({ vertex, fragment, name: "lit-bevels" }),
            resources: { bevelUniforms: this.uniforms, uLight: light.source, uDirection: direction.source },
        });
        this.mesh = new Mesh({ geometry: this.geometry(64), shader });
        this.mesh.blendMode = "add";
    }

    /** Take on `quads` (`render/bevelLighting.ts`), on a canvas `widthPx` by `heightPx`. */
    set(quads: readonly number[], widthPx: number, heightPx: number): void {
        const screen = this.uniforms.uniforms.uScreen as Float32Array;
        screen[0] = widthPx;
        screen[1] = heightPx;
        this.uniforms.update();
        const count = quads.length / BEVEL_QUAD_STRIDE;
        if (count > this.room) this.mesh.geometry = this.geometry(count);
        const geometry = this.mesh.geometry;
        const position = geometry.getBuffer("aPosition").data as Float32Array;
        const normal = geometry.getBuffer("aNormal").data as Float32Array;
        const albedo = geometry.getBuffer("aAlbedo").data as Float32Array;
        for (let q = 0; q < count; q++) {
            const at = q * BEVEL_QUAD_STRIDE;
            for (let v = 0; v < 4; v++) {
                const i = 4 * q + v;
                position[2 * i] = quads[at + 2 * v]!;
                position[2 * i + 1] = quads[at + 2 * v + 1]!;
                normal[2 * i] = quads[at + 8]!;
                normal[2 * i + 1] = quads[at + 9]!;
                albedo[3 * i] = quads[at + 10]!;
                albedo[3 * i + 1] = quads[at + 11]!;
                albedo[3 * i + 2] = quads[at + 12]!;
            }
        }
        // Quads past the last are left with no area, so they draw nothing.
        position.fill(0, 8 * count);
        for (const name of ["aPosition", "aNormal", "aAlbedo"]) geometry.getBuffer(name).update();
        this.mesh.visible = count > 0;
    }

    /** Room for `count` quads, doubling. */
    private geometry(count: number): Geometry {
        let room = Math.max(64, this.room);
        while (room < count) room *= 2;
        this.room = room;
        const indices = new Uint32Array(6 * room);
        for (let q = 0; q < room; q++) indices.set([4 * q, 4 * q + 1, 4 * q + 2, 4 * q, 4 * q + 2, 4 * q + 3], 6 * q);
        return new Geometry({
            attributes: {
                aPosition: { buffer: new Float32Array(8 * room), format: "float32x2" },
                aNormal: { buffer: new Float32Array(8 * room), format: "float32x2" },
                aAlbedo: { buffer: new Float32Array(12 * room), format: "float32x3" },
            },
            indexBuffer: indices,
        });
    }
}
