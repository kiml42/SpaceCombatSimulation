import { Buffer, BufferUsage, Geometry, GlProgram, Mesh, Shader, UniformGroup, type RenderTexture } from "pixi.js";
import { CHROMA_FLOOR, FACING_GLSL } from "./bevelLighting.js";
import { LIGHT_GAIN, LIGHT_HEADROOM } from "./lightField.js";
import { DOME_HEIGHT } from "./shading.js";
import { ROUNDED_VERTEX } from "./roundedLights.js";

/**
 * Rounded parts lit by the dynamic lights by which way each point of them
 * faces (`render/roundedLights.ts` records them): the side of a bell, a barrel
 * or a dome turned towards a light catches it, as the battle's light shades
 * them. Added over the scene from the buffers `render/lightBuffer.ts` draws:
 * how much light falls where, and which way across the surface it comes from.
 *
 * A part laid over a fill the hull is already lit through, as an engine's
 * bell, takes only what its rounding adds; one drawn over it, as a turret's
 * dome, takes all of it.
 */

const vertex = `
in vec2 aPosition;
in vec2 aLocal;
in vec2 aAlong;
in vec2 aAcross;
in vec2 aShape;
in vec3 aAlbedo;
in float aFlat;
out vec2 vScreen;
out vec2 vLocal;
out vec2 vAlong;
out vec2 vAcross;
out vec2 vShape;
out vec3 vAlbedo;
out float vFlat;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec2 uScreen;

void main(void)
{
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
    vScreen = aPosition / uScreen;
    vLocal = aLocal;
    vAlong = aAlong;
    vAcross = aAcross;
    vShape = aShape;
    vAlbedo = aAlbedo;
    vFlat = aFlat;
}
`;

const fragment = `
in vec2 vScreen;
in vec2 vLocal;
in vec2 vAlong;
in vec2 vAcross;
in vec2 vShape;
in vec3 vAlbedo;
in float vFlat;
out vec4 finalColor;

uniform sampler2D uLight;
uniform sampler2D uDirection;
uniform float uGain;
uniform float uHeadroom;
${FACING_GLSL}
void main()
{
    // Which way this point faces: across the canvas, and up out of it.
    vec2 across;
    float up;
    if (vShape.x < 0.5) {
        // A tube, narrowing along its length by its taper.
        float halfWidth = 1.0 + (vShape.y - 1.0) * vLocal.x;
        float v = vLocal.y / halfWidth;
        if (abs(v) >= 1.0) discard;
        across = v * vAcross;
        up = sqrt(1.0 - v * v);
    } else {
        float r2 = dot(vLocal, vLocal);
        if (r2 >= 1.0) discard;
        vec3 n;
        if (vShape.x < 1.5) n = vec3(vLocal, sqrt(1.0 - r2));
        else {
            // A dome, flatter than a hemisphere: the gradient of x² + y² + (z / h)².
            float z = ${DOME_HEIGHT.toFixed(3)} * sqrt(1.0 - r2);
            n = normalize(vec3(vLocal, z / ${(DOME_HEIGHT * DOME_HEIGHT).toFixed(4)}));
        }
        across = n.x * vAlong + n.y * vAcross;
        up = n.z;
    }
    vec3 light = texture(uLight, vScreen).rgb;
    float luminance = dot(light, vec3(0.2126, 0.7152, 0.0722));
    vec3 colour = (light + ${CHROMA_FLOOR.toFixed(3)}) / (luminance + ${CHROMA_FLOOR.toFixed(3)});
    // Facing the light across the deck, and facing up as far as it does past what it already takes from above.
    vec3 taken = max(colour * facing(texture(uDirection, vScreen), across) + light * (up - vFlat), 0.0);
    finalColor = vec4(vAlbedo * (1.0 - exp(-taken * uHeadroom)) * uGain, 0.0);
}
`;

const FLOATS = ROUNDED_VERTEX;
const BYTES = FLOATS * 4;

export class LitRounded {
    readonly mesh: Mesh<Geometry, Shader>;
    private readonly uniforms = new UniformGroup({
        uScreen: { value: new Float32Array([1, 1]), type: "vec2<f32>" },
        uGain: { value: LIGHT_GAIN, type: "f32" },
        uHeadroom: { value: LIGHT_HEADROOM, type: "f32" },
    });
    /** How many parts the geometry has room for. */
    private room = 0;

    /** Lit by `light`, coming from `direction`: the deck's, or a thick module's top's. */
    constructor(light: RenderTexture, direction: RenderTexture) {
        const shader = new Shader({
            glProgram: GlProgram.from({ vertex, fragment, name: "lit-rounded" }),
            resources: { roundedUniforms: this.uniforms, uLight: light.source, uDirection: direction.source },
        });
        this.mesh = new Mesh({ geometry: this.geometry(64), shader });
        this.mesh.blendMode = "add";
    }

    /** Take on `vertices` (`render/roundedLights.ts`), on a canvas `widthPx` by `heightPx`. */
    set(vertices: readonly number[], widthPx: number, heightPx: number): void {
        const screen = this.uniforms.uniforms.uScreen as Float32Array;
        screen[0] = widthPx;
        screen[1] = heightPx;
        this.uniforms.update();
        const parts = vertices.length / (4 * FLOATS);
        if (parts > this.room) this.mesh.geometry = this.geometry(parts);
        const buffer = this.mesh.geometry.getBuffer("aPosition");
        const data = buffer.data as Float32Array;
        data.set(vertices);
        // Parts past the last are left with no area, so they draw nothing.
        data.fill(0, vertices.length);
        buffer.update();
        this.mesh.visible = parts > 0;
    }

    /** Room for `count` parts, doubling. */
    private geometry(count: number): Geometry {
        let room = Math.max(64, this.room);
        while (room < count) room *= 2;
        this.room = room;
        const indices = new Uint32Array(6 * room);
        for (let q = 0; q < room; q++) indices.set([4 * q, 4 * q + 1, 4 * q + 2, 4 * q, 4 * q + 2, 4 * q + 3], 6 * q);
        const buffer = new Buffer({ data: new Float32Array(4 * FLOATS * room), usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
        const at = (format: "float32" | "float32x2" | "float32x3", offset: number) => ({
            buffer,
            format,
            stride: BYTES,
            offset: offset * 4,
        });
        return new Geometry({
            attributes: {
                aPosition: at("float32x2", 0),
                aLocal: at("float32x2", 2),
                aAlong: at("float32x2", 4),
                aAcross: at("float32x2", 6),
                aShape: at("float32x2", 8),
                aAlbedo: at("float32x3", 10),
                aFlat: at("float32", 13),
            },
            indexBuffer: indices,
        });
    }
}
