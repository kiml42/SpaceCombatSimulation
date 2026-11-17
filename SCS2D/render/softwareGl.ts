/**
 * Whether WebGL here is drawn on the CPU rather than a graphics card: a browser
 * with no GPU it will use, or a test runner's. There, antialiasing costs about a
 * third of every frame, so the views go without it.
 */

/** A software renderer, by the name WebGL reports for it: SwiftShader, Mesa's llvmpipe or softpipe, or Windows' WARP. */
export function isSoftwareRenderer(name: string): boolean {
    return /swiftshader|llvmpipe|softpipe|microsoft basic render/i.test(name);
}

let known: boolean | null = null;

/** Whether this page's WebGL is drawn in software, asked once of a throwaway context. */
export function drawnInSoftware(): boolean {
    if (known !== null) return known;
    known = false;
    try {
        const gl = document.createElement("canvas").getContext("webgl2") ?? document.createElement("canvas").getContext("webgl");
        if (gl !== null) {
            const info = gl.getExtension("WEBGL_debug_renderer_info");
            known = isSoftwareRenderer(String(gl.getParameter(info === null ? gl.RENDERER : info.UNMASKED_RENDERER_WEBGL)));
            gl.getExtension("WEBGL_lose_context")?.loseContext();
        }
    } catch {
        // No WebGL to ask: Pixi falls back to Canvas2D, which has no antialias setting.
    }
    return known;
}
