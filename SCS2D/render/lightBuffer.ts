import { Filter, GlProgram, RenderTexture, UniformGroup, type Renderer } from "pixi.js";
import { drawGlows, Lights } from "./glows.js";
import { LIGHT_GAIN, LIGHT_HEADROOM, LIGHT_REACH } from "./lightField.js";
import { PixiCanvas } from "./pixiCanvas.js";

/**
 * The dynamic lights: what engines, flashes, bursts, muzzle flashes, beams and
 * plumes shed on the hulls near them. Each frame the scene's list of light
 * sources (`render/glows.ts`) is drawn into a texture at half the canvas's
 * size, as its glows are drawn, and what is lit by it is drawn a second time
 * through `filter`, its own colour multiplied by the light where it lies on
 * screen, and added over the scene. So a hull takes the light in its own
 * colour, on its shadowed side as on its lit one, and empty space stays dark.
 */

/** The buffer's size as a share of the canvas's: light is soft, so it loses little. */
export const LIGHT_RESOLUTION = 0.5;

const vertex = `
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

const fragment = `
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

export class LightBuffer {
    readonly texture = RenderTexture.create({ width: 1, height: 1 });
    readonly filter: Filter;
    private readonly uniforms = new UniformGroup({
        uScreen: { value: new Float32Array([1, 1]), type: "vec2<f32>" },
        uGain: { value: LIGHT_GAIN, type: "f32" },
        uHeadroom: { value: LIGHT_HEADROOM, type: "f32" },
    });
    private readonly context = new PixiCanvas();
    private readonly reaching = new Lights();

    constructor() {
        this.filter = new Filter({
            glProgram: GlProgram.from({ vertex, fragment, name: "dynamic-light" }),
            resources: { lightUniforms: this.uniforms, uLight: this.texture.source },
            blendMode: "add",
        });
    }

    /**
     * Draw `lights`, in canvas pixels on a canvas `widthPx` by `heightPx`,
     * into the buffer: false, drawing nothing, where there are none.
     */
    update(renderer: Renderer, lights: Lights, widthPx: number, heightPx: number): boolean {
        if (lights.count === 0) return false;
        const width = Math.max(1, Math.ceil(widthPx * LIGHT_RESOLUTION));
        const height = Math.max(1, Math.ceil(heightPx * LIGHT_RESOLUTION));
        if (this.texture.width !== width || this.texture.height !== height) this.texture.resize(width, height);
        const screen = this.uniforms.uniforms.uScreen as Float32Array;
        screen[0] = widthPx;
        screen[1] = heightPx;
        this.context.begin();
        this.context.root.scale.set(LIGHT_RESOLUTION);
        this.reaching.clear();
        this.reaching.add(lights);
        for (let k = 0; k < this.reaching.count; k++) {
            this.reaching.radius[k]! *= LIGHT_REACH;
            this.reaching.brightness[k]! /= LIGHT_HEADROOM;
        }
        drawGlows(this.context as unknown as CanvasRenderingContext2D, this.reaching);
        this.context.end();
        renderer.render({ container: this.context.root, target: this.texture, clear: true, clearColor: [0, 0, 0, 1] });
        return true;
    }
}
