/**
 * Measure how fast the battle view draws, scene by scene, in WebGL and in
 * Canvas2D, in a real browser window on this machine's own graphics. Not part
 * of the game: a tool for asking whether a change to drawing helped, and how a
 * machine copes.
 *
 *   pnpm exec tsx benchmarks/render.ts [--scenes "Duel,Star Wars"] [--renderers webgl,canvas2d]
 *       [--seconds 8] [--at 5] [--warmup 3] [--size 1600x900] [--dpr 1] [--paused] [--vsync]
 *       [--strips shown|hidden] [--screenshots] [--profile]
 *       [--browser chromium|chrome|msedge|firefox] [--executable path] [--headless] [--build] [--label name]
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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs, promisify } from "node:util";
import { chromium, firefox, type Browser, type Page } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const appPage = join(root, "dist", "index.html");

const { values } = parseArgs({
    options: {
        scenes: { type: "string", default: "Duel,Star Wars,Super Swarm,Asteroid Field,Factory" },
        renderers: { type: "string", default: "webgl,canvas2d" },
        seconds: { type: "string", default: "8" },
        warmup: { type: "string", default: "3" },
        at: { type: "string", default: "5" },
        size: { type: "string", default: "1600x900" },
        dpr: { type: "string", default: "1" },
        paused: { type: "boolean", default: false },
        vsync: { type: "boolean", default: false },
        browser: { type: "string", default: "chromium" },
        executable: { type: "string" },
        headless: { type: "boolean", default: false },
        build: { type: "boolean", default: false },
        profile: { type: "boolean", default: false },
        screenshots: { type: "boolean", default: false },
        strips: { type: "string", default: "shown" },
        label: { type: "string", default: "run" },
        out: { type: "string", default: join(here, "results") },
        app: { type: "string" },
        repeat: { type: "string", default: "1" },
    },
});

/** The built pages measured, taken in turn each round, so two builds are measured side by side rather than minutes apart. */
const apps = (values.app?.split(",") ?? [appPage]).map((path) => ({
    path: path.trim(),
    name: basename(dirname(path.trim())) === "dist" ? "dist" : basename(path.trim(), ".html"),
}));
const repeat = Number(values.repeat);

const scenes = values.scenes
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const renderers = values.renderers.split(",").map((s) => s.trim());
for (const r of renderers) if (r !== "webgl" && r !== "canvas2d") throw new Error(`unknown renderer "${r}": webgl or canvas2d`);
const [width, height] = values.size.split("x").map(Number) as [number, number];
const seconds = Number(values.seconds);
const warmup = Number(values.warmup);
const at = Number(values.at);
if (values.strips !== "shown" && values.strips !== "hidden") throw new Error(`--strips is shown or hidden, not "${values.strips}"`);

interface Result {
    app: string;
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
    /** Battle time when measuring began, s. */
    battleAt: number;
    /** Battle seconds a second while measured: 1 keeps up at 1x, less is falling behind, 0 is paused. */
    simSpeed: number;
}

if (values.build || !existsSync(appPage)) {
    console.log("Building the app…");
    if (process.platform === "win32") await promisify(execFile)("cmd.exe", ["/c", "npx", "vite", "build"], { cwd: root });
    else await promisify(execFile)("npx", ["vite", "build"], { cwd: root });
}

const inFirefox = values.browser === "firefox";
mkdirSync(values.out, { recursive: true });

/**
 * A window, so the browser draws on the machine's own GPU; headless usually draws in software.
 * In Firefox, `geckoTo` is where it writes a profile of everything it ran, when it closes: it
 * has no protocol to hand one over mid-run.
 */
async function launch(geckoTo?: string): Promise<Browser> {
    if (!inFirefox)
        return chromium.launch({
            headless: values.headless,
            ...(values.executable !== undefined
                ? { executablePath: values.executable }
                : values.browser === "chromium"
                  ? {}
                  : { channel: values.browser }),
            args: values.vsync ? [] : ["--disable-gpu-vsync", "--disable-frame-rate-limit"],
        });
    // The installed Firefox, over WebDriver BiDi. A frame rate of 0 is as fast as it can draw; timers are
    // otherwise rounded to the millisecond, too coarse for a frame's work. Its profiler keeps the JS and the
    // browser's labelled work, not native stacks, so its buffer holds a whole run.
    const profiler = {
        MOZ_PROFILER_STARTUP: "1",
        MOZ_PROFILER_STARTUP_INTERVAL: "2",
        MOZ_PROFILER_STARTUP_ENTRIES: String(2 ** 23),
        MOZ_PROFILER_STARTUP_FEATURES: "js",
        MOZ_PROFILER_STARTUP_FILTERS: "GeckoMain",
        MOZ_PROFILER_SHUTDOWN: geckoTo ?? "",
    };
    return firefox.launch({
        channel: "moz-firefox",
        headless: values.headless,
        ...(values.executable !== undefined ? { executablePath: values.executable } : {}),
        firefoxUserPrefs: { "privacy.reduceTimerPrecision": false, ...(values.vsync ? {} : { "layout.frame_rate": 0 }) },
        ...(geckoTo !== undefined ? { env: { ...process.env, ...profiler } } : {}),
    });
}

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
    window.battleTime = () => Number(/t ([\\d.]+) s/.exec(document.querySelector("#readout")?.textContent ?? "")?.[1] ?? 0);
}`;

declare global {
    /** The battle's time, seconds, as the page's readout shows it (set by INSTRUMENT). */
    function battleTime(): number;
}

/** Clicked in the page, not by Playwright, which waits for frames that a slow scene is long in drawing. */
async function setPlaying(page: Page, play: boolean): Promise<void> {
    await page.evaluate((play) => {
        const button = document.querySelector<HTMLButtonElement>("#play")!;
        if ((button.textContent === "Pause") !== play) button.click();
    }, play);
}

const percentile = (sorted: number[], p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? NaN;

async function measure(page: Page): Promise<Omit<Result, "app" | "renderer" | "scene" | "battleAt" | "simSpeed">> {
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

interface ProfileNode {
    id: number;
    callFrame: { functionName: string; url: string; lineNumber: number; columnNumber: number };
}

/**
 * A CPU profile of the page over `seconds`, after the measuring, so it does not
 * slow the figures. Written whole, for DevTools' Performance panel, and summed
 * by function: the share of the main thread's samples spent in each.
 */
async function profile(page: Page, name: string): Promise<{ file: string; top: { fn: string; ms: number; share: number }[] }> {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
    await cdp.send("Profiler.start");
    await page.waitForTimeout(seconds * 1000);
    const { profile: taken } = await cdp.send("Profiler.stop");
    await cdp.detach();
    const nodes = new Map<number, ProfileNode>((taken.nodes as ProfileNode[]).map((n) => [n.id, n]));
    const self = new Map<string, number>();
    let total = 0;
    taken.samples?.forEach((id, k) => {
        const frame = nodes.get(id)!.callFrame;
        if (frame.functionName === "(idle)" || frame.functionName === "(program)") return;
        const ms = (taken.timeDeltas?.[k] ?? 0) / 1000;
        const where = frame.url === "" ? "" : ` :${frame.lineNumber + 1}:${frame.columnNumber + 1}`;
        const fn = `${frame.functionName || "(anonymous)"}${where}`;
        self.set(fn, (self.get(fn) ?? 0) + ms);
        total += ms;
    });
    const file = join(values.out, `render-${values.label}-${name}.cpuprofile`);
    writeFileSync(file, JSON.stringify(taken));
    const top = [...self.entries()]
        .sort((p, q) => q[1] - p[1])
        .slice(0, 15)
        .map(([fn, ms]) => ({ fn, ms, share: ms / total }));
    return { file, top };
}

/** The wall-clock spans each scene was profiled over in Firefox, to be found in its profile once it closes. */
const geckoSpans: { name: string; from: number; to: number }[] = [];

const results: Result[] = [];
let gpu = "unknown";
// Profiling in Firefox, a browser a scene, each writing its own profile as it closes: one holding a longer run loses its start.
const geckoEach = inFirefox && values.profile;
const shared = geckoEach ? null : await launch();
try {
    for (let round = 0; round < repeat; round++)
        for (const app of apps)
            for (const renderer of renderers)
                for (const group of geckoEach ? scenes.map((s) => [s]) : [scenes]) {
                    const geckoTo = geckoEach
                        ? join(values.out, `render-${values.label}-${renderer}-${group[0]!.replaceAll(" ", "")}.gecko.json`)
                        : undefined;
                    const browser = shared ?? (await launch(geckoTo));
                    geckoSpans.length = 0;
                    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: Number(values.dpr) });
                    await context.addInitScript((r) => {
                        try {
                            window.localStorage.setItem("scs2d.draw", r);
                        } catch {
                            // Firefox runs this in about:blank too, whose storage is refused; the app's page is the one that matters.
                        }
                    }, renderer);
                    await context.addInitScript({ content: INSTRUMENT });
                    const page = await context.newPage();
                    page.on("pageerror", (error) => console.error(`page error: ${error.message}`));
                    await page.goto(`${pathToFileURL(app.path).href}#/battle`);
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
                    const expected = renderer === "webgl" ? "Draw: WebGL" : "Draw: 2D";
                    if (drawing !== expected) console.warn(`asked for ${renderer}, but the view says "${drawing}"`);
                    const fleets = page.getByRole("button", { name: /^Fleets:/ });
                    if ((await fleets.textContent()) !== `Fleets: ${values.strips}`) await fleets.click();
                    for (const scene of group) {
                        // Whether a new scene plays depends on the last; each is played to the same moment, so every run shows the same frame.
                        await page.selectOption("#scene", { label: scene });
                        // The readout is sampled, so it shows the last scene's time for a moment.
                        await page.waitForFunction(() => battleTime() < 1, null, { polling: 50 });
                        await setPlaying(page, true);
                        await page.waitForFunction((t) => battleTime() >= t, at, { polling: 50, timeout: 300_000 });
                        if (values.paused) await setPlaying(page, false);
                        await page.waitForTimeout(warmup * 1000);
                        const from = await page.evaluate(() => battleTime());
                        const measured = await measure(page);
                        const to = await page.evaluate(() => battleTime());
                        const result = { app: app.name, renderer, scene, ...measured, battleAt: from, simSpeed: (to - from) / seconds };
                        results.push(result);
                        console.log(
                            `${apps.length > 1 ? `${app.name.padEnd(10)} ` : ""}${renderer.padEnd(8)} ${scene.padEnd(16)}` +
                                ` ${result.fps.toFixed(1).padStart(6)} fps  ` +
                                `frame ${result.frameP50.toFixed(1)} / ${result.frameP95.toFixed(1)} ms  js ${result.jsP50.toFixed(1)} / ${result.jsP95.toFixed(1)} ms`,
                        );
                        if (values.screenshots)
                            await page.screenshot({
                                path: join(values.out, `render-${values.label}-${renderer}-${scene.replaceAll(" ", "")}.png`),
                            });
                        if (values.profile && inFirefox) {
                            const from = Date.now();
                            await page.waitForTimeout(seconds * 1000);
                            geckoSpans.push({ name: `${renderer} ${scene}`, from, to: Date.now() });
                        } else if (values.profile) {
                            const { file, top } = await profile(page, `${renderer}-${scene.replaceAll(" ", "")}`);
                            for (const { fn, ms, share } of top)
                                console.log(`    ${(share * 100).toFixed(1).padStart(5)}% ${ms.toFixed(0).padStart(6)} ms  ${fn}`);
                            console.log(`    profile: ${file}`);
                        }
                    }
                    if (geckoTo === undefined) await context.close();
                    else {
                        // Closed whole, page and all, so the page's process is still there to be profiled as it shuts down.
                        await browser.close();
                        summariseGecko(geckoTo);
                    }
                }
} finally {
    await shared?.close();
}

interface GeckoTable {
    schema: Record<string, number>;
    data: (number | string | null)[][];
}
interface GeckoThread {
    name: string;
    samples: GeckoTable;
    stackTable: GeckoTable;
    frameTable: GeckoTable;
    stringTable: string[];
}
interface GeckoProcess {
    meta: { startTime: number };
    threads: GeckoThread[];
    processes?: GeckoProcess[];
}

/**
 * Firefox's profile, summed over each scene's span: every sample goes to the
 * innermost function of the app's own code on its stack, so time in the
 * browser below it (drawing calls, garbage collection) counts to what asked
 * for it. The page's process is the one whose main thread runs the app.
 */
function summariseGecko(geckoProfile: string): void {
    if (!existsSync(geckoProfile)) {
        console.warn(`\nFirefox wrote no profile to ${geckoProfile}`);
        return;
    }
    const root = JSON.parse(readFileSync(geckoProfile, "utf8")) as GeckoProcess;
    const all: GeckoProcess[] = [];
    const walk = (p: GeckoProcess): void => {
        all.push(p);
        p.processes?.forEach(walk);
    };
    walk(root);
    // As "drawScene (file:///…/index.html#/battle:59138:19)[55]".
    const app = /^(.*) \(file:.*\/[^/]*\.html[^:]*:(\d+):\d+\)(\[\d+\])?$/;
    for (const span of geckoSpans) {
        let best: Map<string, number> | null = null;
        let bestTotal = 0;
        for (const process of all) {
            for (const thread of process.threads.filter((t) => t.name === "GeckoMain")) {
                const { samples, stackTable, frameTable, stringTable } = thread;
                const [timeAt, stackAt] = [samples.schema.time!, samples.schema.stack!];
                const [prefixAt, frameAt, locationAt] = [stackTable.schema.prefix!, stackTable.schema.frame!, frameTable.schema.location!];
                const charged = new Map<string, number>();
                let total = 0;
                let last = NaN;
                let hasApp = false;
                for (const sample of samples.data) {
                    const time = process.meta.startTime + (sample[timeAt] as number);
                    const ms = Number.isNaN(last) ? 0 : time - last;
                    last = time;
                    if (time < span.from || time > span.to) continue;
                    // Outside the app's code, the browser's own innermost labelled work, as "PresShell::Paint".
                    let fn: string | null = null;
                    let label: string | null = null;
                    for (
                        let stack = sample[stackAt] as number | null;
                        stack !== null;
                        stack = stackTable.data[stack]![prefixAt] as number | null
                    ) {
                        const location = stringTable[frameTable.data[stackTable.data[stack]![frameAt] as number]![locationAt] as number]!;
                        const match = app.exec(location);
                        if (match !== null) {
                            fn = `${match[1]} :${match[2]}`;
                            hasApp = true;
                            break;
                        }
                        if (label === null && !location.startsWith("0x") && !location.includes("(")) label = location;
                    }
                    fn ??= `(browser) ${label ?? "unlabelled"}`;
                    if (stackTable.data[sample[stackAt] as number] === undefined) fn = "(idle)";
                    charged.set(fn, (charged.get(fn) ?? 0) + ms);
                    total += ms;
                }
                if (hasApp && total > bestTotal) [best, bestTotal] = [charged, total];
            }
        }
        console.log(`\n${span.name}, Firefox:`);
        if (best === null) {
            console.log("    no samples of the app's code in its span");
            continue;
        }
        for (const [fn, ms] of [...best.entries()].sort((p, q) => q[1] - p[1]).slice(0, 15))
            console.log(`    ${((ms / bestTotal) * 100).toFixed(1).padStart(5)}% ${ms.toFixed(0).padStart(6)} ms  ${fn}`);
    }
    console.log(`    profile: ${geckoProfile} (opens at profiler.firefox.com)`);
}

const ms = (n: number): string => n.toFixed(1).padStart(7);
console.log(`\nGPU: ${gpu}`);
console.log(
    `${width}x${height} at ${values.dpr}x, ${values.paused ? "paused" : "running"} from ${at} s, ${values.vsync ? "vsync" : "uncapped"}, strips ${values.strips}`,
);
// With repeats, each figure is the median of its rounds, and the fps range shows how far they spread.
const median = (xs: number[]): number => {
    const sorted = [...xs].sort((a, b) => a - b);
    const mid = sorted.length / 2;
    return sorted.length % 2 === 1 ? sorted[Math.floor(mid)]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};
const groups = new Map<string, Result[]>();
for (const r of results) {
    const key = `${r.app}|${r.renderer}|${r.scene}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
}
const appColumn = apps.length > 1 ? 11 : 0;
console.log(
    `\n${apps.length > 1 ? "app".padEnd(appColumn) : ""}${"renderer".padEnd(9)}${"scene".padEnd(17)}${"fps".padStart(7)}` +
        `  frame p50    p95  worst   js p50    p95   from    sim${repeat > 1 ? "  fps range" : ""}`,
);
for (const rs of groups.values()) {
    const r = rs[0]!;
    const m = (f: (r: Result) => number): number => median(rs.map(f));
    const fpsAll = rs.map((x) => x.fps);
    console.log(
        `${apps.length > 1 ? r.app.padEnd(appColumn) : ""}${r.renderer.padEnd(9)}${r.scene.padEnd(17)}${m((x) => x.fps)
            .toFixed(1)
            .padStart(7)}` +
            `  ${ms(m((x) => x.frameP50))}${ms(m((x) => x.frameP95))}${ms(Math.max(...rs.map((x) => x.frameWorst)))}` +
            `  ${ms(m((x) => x.jsP50))}${ms(m((x) => x.jsP95))}${m((x) => x.battleAt)
                .toFixed(1)
                .padStart(6)}s${m((x) => x.simSpeed)
                .toFixed(2)
                .padStart(6)}x` +
            (repeat > 1 ? `  ${Math.min(...fpsAll).toFixed(1)}–${Math.max(...fpsAll).toFixed(1)}` : ""),
    );
}

const file = join(values.out, `render-${values.label}.json`);
writeFileSync(
    file,
    JSON.stringify(
        {
            label: values.label,
            gpu,
            width,
            height,
            dpr: Number(values.dpr),
            paused: values.paused,
            vsync: values.vsync,
            strips: values.strips,
            at,
            seconds,
            repeat,
            results,
        },
        null,
        2,
    ),
);
console.log(`\nWritten to ${file}`);
