import { Container, Filter, Geometry, GlProgram, Mesh, RenderTexture, Shader, UniformGroup, type Renderer } from "pixi.js";
import type { Lights } from "./glows.js";
import { THICK_SHADOW_M } from "./light.js";
import { LIGHT_GAIN, LIGHT_HEADROOM, lightReach, lightTop } from "./lightField.js";
import { rgba } from "./sprites.js";

/**
 * The dynamic lights: what engines, flashes, bursts, muzzle flashes, beams and
 * plumes shed on the hulls near them. Each frame the scene's list of light
 * sources (`render/glows.ts`) is drawn into a texture at half the canvas's
 * size, and what is lit by it is drawn a second time through a filter, its own
 * colour multiplied by the light where it lies on screen, and added over the
 * scene. So a hull takes the light in its own colour, on its shadowed side as
 * on its lit one, and empty space stays dark.
 *
 * Each light is a quad its shader lights the inside of, as `render/lightField.ts`
 * works it out: from above the deck, by its distance in three dimensions and
 * by how squarely it shines down. Drawn once onto the deck, once onto a thick
 * module's top, since a light at a fighter's height shines down on the thin
 * hull and only across a thick module's top beside it, and once halfway
 * between, for capital ships' turrets.
 */

/** The buffer's size as a share of the canvas's: light is soft, so it loses little. */
export const LIGHT_RESOLUTION = 0.5;

/** How far behind its root a cone's light starts, and how much narrower it is at its tip, as `render/lightField.ts` has them. */
const CONE_BEHIND = 0.4;
const CONE_NARROWING = 0.85;

const lightVertex = `
in vec2 aPosition;
in vec4 aEnds;
in vec4 aShape;
in vec4 aColour;
out vec2 vPosition;
out vec4 vEnds;
out vec4 vShape;
out vec4 vColour;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

void main(void)
{
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
    vPosition = aPosition;
    vEnds = aEnds;
    vShape = aShape;
    vColour = aColour;
}
`;

const lightFragment = `
in vec2 vPosition;
in vec4 vEnds;
in vec4 vShape;
in vec4 vColour;
out vec4 finalColor;

uniform float uSurface;
uniform float uDirection;

float falloff(float r)
{
    if (r >= 1.0) return 0.0;
    float left = 1.0 - r * r;
    return left * left;
}

void main()
{
    // Canvas pixels throughout: its ends, how far it reaches, its bottom and top and how bright it is.
    vec2 from = vEnds.xy;
    vec2 run = vEnds.zw - from;
    float reach = vShape.x;
    float bottom = vShape.y;
    float top = vColour.a;
    float brightness = vShape.z;
    bool cone = vShape.w > 0.5;
    // As thick as a flame: what is partway up it takes the share above, from that share's middle.
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
    if (uDirection < 0.5) {
        // On a surface facing up: as much as shines down on it.
        finalColor = vec4(vColour.rgb * brightness * strength * share * down, 0.0);
    } else {
        // Which way across the surface it comes from, by how bright it is: the part of the
        // way to it along the surface, each half of each axis in a channel of its own, as
        // what is summed additively cannot go below nothing.
        vec2 toward = -off / max(distance, 1e-6) * brightness * strength * dot(vColour.rgb, vec3(0.2126, 0.7152, 0.0722));
        finalColor = vec4(max(toward.x, 0.0), max(-toward.x, 0.0), max(toward.y, 0.0), max(-toward.y, 0.0));
    }
}
`;

const filterVertex = `
in vec2 aPosition;
out vec2 vTextureCoord;
out vec2 vScreen;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
uniform vec2 uScreen;

void main(void)
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    // Where on the canvas, from its top left, for the light there.
    vScreen = position / uScreen;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    gl_Position = vec4(position, 0.0, 1.0);
    vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
}
`;

const filterFragment = `
in vec2 vTextureCoord;
in vec2 vScreen;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform sampler2D uLight;
uniform float uGain;
uniform float uHeadroom;

void main()
{
    vec4 colour = texture(uTexture, vTextureCoord);
    // Easing towards full as it grows, so the brightest stretch is not lit flat.
    vec3 light = 1.0 - exp(-texture(uLight, vScreen).rgb * uHeadroom);
    // Added over what is there, so it leaves the alpha alone.
    finalColor = vec4(colour.rgb * light * uGain, 0.0);
}
`;

/**
 * The light on one height of surface: what it is drawn into, which way across
 * the surface it comes from (`direction`, for what does not face up, as a
 * bevel), and the filter that lights a layer facing up by it.
 */
class Surface {
    // Half floats: at 8 bits, faint light steps up a level at a different distance in each channel,
    // which with the headroom scaled back shows as coloured rings round a light.
    readonly texture = RenderTexture.create({ width: 1, height: 1, format: "rgba16float" });
    readonly direction = RenderTexture.create({ width: 1, height: 1, format: "rgba16float" });
    readonly filter: Filter;

    constructor(screen: UniformGroup) {
        this.filter = new Filter({
            glProgram: GlProgram.from({ vertex: filterVertex, fragment: filterFragment, name: "dynamic-light" }),
            resources: { lightUniforms: screen, uLight: this.texture.source },
            blendMode: "add",
        });
    }
}

export class LightBuffer {
    /** Lighting the thin hull, and rock: a light shining down on the deck. */
    private readonly deck: Surface;
    /** Lighting thick modules' tops, a thick module's height above it. */
    private readonly thick: Surface;
    /** Halfway between, where capital ships' turrets stand. */
    private readonly middle: Surface;
    private readonly uniforms = new UniformGroup({
        uScreen: { value: new Float32Array([1, 1]), type: "vec2<f32>" },
        uGain: { value: LIGHT_GAIN, type: "f32" },
        uHeadroom: { value: LIGHT_HEADROOM, type: "f32" },
    });
    private readonly surface = new UniformGroup({ uSurface: { value: 0, type: "f32" }, uDirection: { value: 0, type: "f32" } });
    private readonly root = new Container();
    private readonly mesh: Mesh<Geometry, Shader>;
    /** How many lights the geometry has room for. */
    private room = 0;

    constructor() {
        this.deck = new Surface(this.uniforms);
        this.thick = new Surface(this.uniforms);
        this.middle = new Surface(this.uniforms);
        const shader = new Shader({
            glProgram: GlProgram.from({ vertex: lightVertex, fragment: lightFragment, name: "dynamic-light-source" }),
            resources: { surfaceUniforms: this.surface },
        });
        this.mesh = new Mesh({ geometry: this.geometry(64), shader });
        this.mesh.blendMode = "add";
        this.root.addChild(this.mesh);
    }

    /** The filter lighting the thin hull and rock. */
    get deckFilter(): Filter {
        return this.deck.filter;
    }

    /** The filter lighting thick modules. */
    get thickFilter(): Filter {
        return this.thick.filter;
    }

    /** The light on the deck and on thick modules' tops, and which way across each it comes from. */
    get deckLight(): RenderTexture {
        return this.deck.texture;
    }
    get deckDirection(): RenderTexture {
        return this.deck.direction;
    }
    get thickLight(): RenderTexture {
        return this.thick.texture;
    }
    get thickDirection(): RenderTexture {
        return this.thick.direction;
    }
    get middleLight(): RenderTexture {
        return this.middle.texture;
    }
    get middleDirection(): RenderTexture {
        return this.middle.direction;
    }

    /**
     * Draw `lights`, in canvas pixels on a canvas `widthPx` by `heightPx` at
     * `scale` pixels to the metre, into the buffers: false, drawing nothing,
     * where there are none.
     */
    update(renderer: Renderer, lights: Lights, widthPx: number, heightPx: number, scale: number): boolean {
        if (lights.count === 0) return false;
        const width = Math.max(1, Math.ceil(widthPx * LIGHT_RESOLUTION));
        const height = Math.max(1, Math.ceil(heightPx * LIGHT_RESOLUTION));
        for (const surface of [this.deck, this.thick, this.middle]) {
            for (const texture of [surface.texture, surface.direction]) {
                if (texture.width !== width || texture.height !== height) texture.resize(width, height);
            }
        }
        const screen = this.uniforms.uniforms.uScreen as Float32Array;
        screen[0] = widthPx;
        screen[1] = heightPx;
        if (!this.fill(lights)) return false;
        this.root.scale.set(LIGHT_RESOLUTION);
        const draw = (surface: Surface, height: number): void => {
            this.surface.uniforms.uSurface = height;
            this.surface.uniforms.uDirection = 0;
            this.surface.update();
            renderer.render({ container: this.root, target: surface.texture, clear: true, clearColor: [0, 0, 0, 1] });
            this.surface.uniforms.uDirection = 1;
            this.surface.update();
            renderer.render({ container: this.root, target: surface.direction, clear: true, clearColor: [0, 0, 0, 0] });
        };
        draw(this.deck, 0);
        draw(this.thick, THICK_SHADOW_M * scale);
        draw(this.middle, (THICK_SHADOW_M / 2) * scale);
        return true;
    }

    /** Each light as a quad over all it reaches, with what its shader needs: false if none lights anything. */
    private fill(lights: Lights): boolean {
        if (lights.count > this.room) this.mesh.geometry = this.geometry(lights.count);
        const geometry = this.mesh.geometry;
        const position = geometry.getBuffer("aPosition").data as Float32Array;
        const ends = geometry.getBuffer("aEnds").data as Float32Array;
        const shape = geometry.getBuffer("aShape").data as Float32Array;
        const colour = geometry.getBuffer("aColour").data as Float32Array;
        let n = 0;
        for (let k = 0; k < lights.count; k++) {
            // A glow that lights nothing round it, as a muzzle flash's wedge.
            if (lights.lightless[k] === 1) continue;
            let x0 = lights.x0[k]!;
            let y0 = lights.y0[k]!;
            let x1 = lights.x1[k]!;
            let y1 = lights.y1[k]!;
            // Under a pixel long, a line is a point at its middle, as its glow is drawn.
            if ((x1 - x0) ** 2 + (y1 - y0) ** 2 < 1) {
                x0 = x1 = (x0 + x1) / 2;
                y0 = y1 = (y0 + y1) / 2;
            }
            const radius = lights.radius[k]!;
            const reach = radius * lightReach(lights.brightness[k]!);
            const cone = lights.cone[k] === 1 && (x1 !== x0 || y1 !== y0);
            const [r, g, b] = rgba(lights.colour[k]!);
            // As bright as its glow can be drawn, at the buffer's headroom's share.
            const brightness = Math.min(1, lights.brightness[k]! / LIGHT_HEADROOM);
            const left = Math.min(x0, x1) - reach;
            const right = Math.max(x0, x1) + reach;
            const bottom = Math.min(y0, y1) - reach;
            const top = Math.max(y0, y1) + reach;
            const corners = [left, bottom, right, bottom, right, top, left, top];
            for (let v = 0; v < 4; v++) {
                const i = 4 * n + v;
                position[2 * i] = corners[2 * v]!;
                position[2 * i + 1] = corners[2 * v + 1]!;
                ends[4 * i] = x0;
                ends[4 * i + 1] = y0;
                ends[4 * i + 2] = x1;
                ends[4 * i + 3] = y1;
                shape[4 * i] = reach;
                shape[4 * i + 1] = lights.height[k]!;
                shape[4 * i + 2] = brightness;
                shape[4 * i + 3] = cone ? 1 : 0;
                colour[4 * i] = r / 255;
                colour[4 * i + 1] = g / 255;
                colour[4 * i + 2] = b / 255;
                colour[4 * i + 3] = lightTop(lights.height[k]!, radius);
            }
            n++;
        }
        if (n === 0) return false;
        // Quads past the last light's are left with no area, so they draw nothing.
        position.fill(0, 8 * n);
        for (const name of ["aPosition", "aEnds", "aShape", "aColour"]) geometry.getBuffer(name).update();
        return true;
    }

    /** Room for `count` lights' quads, doubling. */
    private geometry(count: number): Geometry {
        let room = Math.max(64, this.room);
        while (room < count) room *= 2;
        this.room = room;
        const indices = new Uint32Array(6 * room);
        for (let q = 0; q < room; q++) indices.set([4 * q, 4 * q + 1, 4 * q + 2, 4 * q, 4 * q + 2, 4 * q + 3], 6 * q);
        return new Geometry({
            attributes: {
                aPosition: { buffer: new Float32Array(8 * room), format: "float32x2" },
                aEnds: { buffer: new Float32Array(16 * room), format: "float32x4" },
                aShape: { buffer: new Float32Array(16 * room), format: "float32x4" },
                aColour: { buffer: new Float32Array(16 * room), format: "float32x4" },
            },
            indexBuffer: indices,
        });
    }
}
