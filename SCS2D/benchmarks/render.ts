/**
 * Measure how fast the battle view draws, scene by scene, in WebGL and in
 * Canvas2D, in a real browser window on this machine's own graphics. Not part
 * of the game: a tool for asking whether a change to drawing helped, and how a
 * machine copes.
 *
 *   pnpm exec tsx benchmarks/render.ts [--scenes "Duel,Star Wars"] [--renderers webgl,canvas2d]
 *       [--seconds 8] [--warmup 3] [--size 1600x900] [--dpr 1] [--paused] [--vsync]
 *       [--browser chromium|chrome|msedge] [--executable path] [--headless] [--build] [--label name]
 *
 * Each scene runs on the Battle route as a player sees it, and two things are
 * timed each frame: the gap between frames, and the main thread's time in the
 * frame's callbacks (simulating and drawing; WebGL's GPU work is not in it).
 * `--paused` holds the battle so that time is drawing alone. Without `--vsync`
 * the frame rate is not held to the display's, so a fast machine shows how far
 * over 60 it could go. Results print as a table and are written to
 * `benchmarks/results/render-<label>.json`.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs, promisify } from "node:util";
import { chromium, type Page } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const appPage = join(root, "dist", "index.html");

const { values } = parseArgs({
    options: {
        scenes: { type: "string", default: "Duel,Star Wars,Super Swarm,Asteroid Field,Factory" },
        renderers: { type: "string", default: "webgl,canvas2d" },
        seconds: { type: "string", default: "8" },
        warmup: { type: "string", default: "3" },
        size: { type: "string", default: "1600x900" },
        dpr: { type: "string", default: "1" },
        paused: { type: "boolean", default: false },
        vsync: { type: "boolean", default: false },
        browser: { type: "string", default: "chromium" },
        executable: { type: "string" },
        headless: { type: "boolean", default: false },
        build: { type: "boolean", default: false },
        label: { type: "string", default: "run" },
        out: { type: "string", default: join(here, "results") },
    },
});

const scenes = values.scenes
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const renderers = values.renderers.split(",").map((s) => s.trim());
for (const r of renderers) if (r !== "webgl" && r !== "canvas2d") throw new Error(`unknown renderer "${r}": webgl or canvas2d`);
const [width, height] = values.size.split("x").map(Number) as [number, number];
const seconds = Number(values.seconds);
const warmup = Number(values.warmup);

interface Result {
    renderer: string;
    scene: string;
    frames: number;
    fps: number;
    /** Gap between frames, ms. */
    frameP50: number;
    frameP95: number;
    frameWorst: number;
    /** Main-thread time in a frame's callbacks, ms. */
    jsP50: number;
    jsP95: number;
}

if (values.build || !existsSync(appPage)) {
    console.log("Building the app…");
    if (process.platform === "win32") await promisify(execFile)("cmd.exe", ["/c", "npx", "vite", "build"], { cwd: root });
    else await promisify(execFile)("npx", ["vite", "build"], { cwd: root });
}

const browser = await chromium.launch({
    // A window, so the browser draws on the machine's own GPU; headless usually draws in software.
    headless: values.headless,
    ...(values.executable !== undefined
        ? { executablePath: values.executable }
        : values.browser === "chromium"
          ? {}
          : { channel: values.browser }),
    args: values.vsync ? [] : ["--disable-gpu-vsync", "--disable-frame-rate-limit"],
});

/**
 * Times every animation frame callback the page asks for, from before the app
 * loads. Text rather than a function, as tsx's helpers do not exist in the page.
 */
const INSTRUMENT = `{
    const bench = { on: false, gaps: [], busy: new Map(), last: 0 };
    window.__bench = bench;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) =>
        raf((t) => {
            const start = performance.now();
            callback(t);
            if (bench.on) bench.busy.set(t, (bench.busy.get(t) ?? 0) + performance.now() - start);
        });
    const each = (t) => {
        if (bench.on && bench.last > 0) bench.gaps.push(t - bench.last);
        bench.last = t;
        raf(each);
    };
    raf(each);
}`;

const percentile = (sorted: number[], p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? NaN;

async function measure(page: Page): Promise<Omit<Result, "renderer" | "scene">> {
    await page.evaluate(() => {
        const bench = (window as unknown as { __bench: { on: boolean; gaps: number[]; busy: Map<number, number>; last: number } }).__bench;
        bench.gaps = [];
        bench.busy.clear();
        bench.last = 0;
        bench.on = true;
    });
    await page.waitForTimeout(seconds * 1000);
    const { gaps, busy } = await page.evaluate(() => {
        const bench = (window as unknown as { __bench: { on: boolean; gaps: number[]; busy: Map<number, number> } }).__bench;
        bench.on = false;
        return { gaps: bench.gaps, busy: [...bench.busy.values()] };
    });
    gaps.sort((a, b) => a - b);
    busy.sort((a, b) => a - b);
    const total = gaps.reduce((sum, g) => sum + g, 0);
    return {
        frames: gaps.length,
        fps: total > 0 ? (gaps.length * 1000) / total : 0,
        frameP50: percentile(gaps, 0.5),
        frameP95: percentile(gaps, 0.95),
        frameWorst: gaps[gaps.length - 1] ?? NaN,
        jsP50: percentile(busy, 0.5),
        jsP95: percentile(busy, 0.95),
    };
}

const results: Result[] = [];
let gpu = "unknown";
try {
    for (const renderer of renderers) {
        const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: Number(values.dpr) });
        await context.addInitScript((r) => window.localStorage.setItem("scs2d.draw", r), renderer);
        await context.addInitScript({ content: INSTRUMENT });
        const page = await context.newPage();
        page.on("pageerror", (error) => console.error(`page error: ${error.message}`));
        await page.goto(`${pathToFileURL(appPage).href}#/battle`);
        gpu = await page.evaluate(() => {
            const gl = document.createElement("canvas").getContext("webgl");
            const info = gl?.getExtension("WEBGL_debug_renderer_info");
            return gl === null || gl === undefined
                ? "no WebGL"
                : String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
        });
        const draw = page.getByRole("button", { name: /^Draw:/ });
        // WebGL starts a moment after the page does.
        await page.waitForTimeout(1000);
        const drawing = (await draw.textContent()) ?? "";
        if (renderer === "webgl" && drawing !== "Draw: WebGL") console.warn(`asked for WebGL, but the view says "${drawing}"`);
        for (const scene of scenes) {
            await page.selectOption("#scene", { label: scene });
            await page.waitForTimeout(300);
            const playing = (await page.textContent("#play")) === "Pause";
            if (values.paused === playing) await page.click("#play");
            await page.waitForTimeout(warmup * 1000);
            const result = { renderer, scene, ...(await measure(page)) };
            results.push(result);
            console.log(
                `${renderer.padEnd(8)} ${scene.padEnd(16)} ${result.fps.toFixed(1).padStart(6)} fps  ` +
                    `frame ${result.frameP50.toFixed(1)} / ${result.frameP95.toFixed(1)} ms  js ${result.jsP50.toFixed(1)} / ${result.jsP95.toFixed(1)} ms`,
            );
        }
        await context.close();
    }
} finally {
    await browser.close();
}

const ms = (n: number): string => n.toFixed(1).padStart(7);
console.log(`\nGPU: ${gpu}`);
console.log(`${width}x${height} at ${values.dpr}x, ${values.paused ? "paused" : "running"}, ${values.vsync ? "vsync" : "uncapped"}`);
console.log(`\n${"renderer".padEnd(9)}${"scene".padEnd(17)}${"fps".padStart(7)}  frame p50    p95  worst   js p50    p95`);
for (const r of results) {
    console.log(
        `${r.renderer.padEnd(9)}${r.scene.padEnd(17)}${r.fps.toFixed(1).padStart(7)}  ${ms(r.frameP50)}${ms(r.frameP95)}${ms(r.frameWorst)}  ${ms(r.jsP50)}${ms(r.jsP95)}`,
    );
}

mkdirSync(values.out, { recursive: true });
const file = join(values.out, `render-${values.label}.json`);
writeFileSync(
    file,
    JSON.stringify(
        { label: values.label, gpu, width, height, dpr: Number(values.dpr), paused: values.paused, vsync: values.vsync, seconds, results },
        null,
        2,
    ),
);
console.log(`\nWritten to ${file}`);
