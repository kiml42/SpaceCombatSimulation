import earcut from "earcut";
import {
    AdditiveBlending,
    BufferAttribute,
    BufferGeometry,
    CanvasTexture,
    DoubleSide,
    LinearFilter,
    Matrix4,
    Mesh,
    MeshBasicMaterial,
    NoColorSpace,
    NormalBlending,
    Object3D,
    RepeatWrapping,
    type Texture,
    type WebGLRenderer,
} from "three";
import {
    anchorX,
    anchorY,
    arcSweep,
    clipPolygon,
    clipPolyline,
    convexHullOrder,
    dashed,
    fontFamily,
    fontSize,
    parseColour,
    screenRect,
    type Clip,
} from "../pixiCanvas.js";
import type { Solid3D } from "../solid3d.js";

/**
 * The parts of a Canvas2D context that canvas2d.ts draws with, drawn with
 * three.js instead: `PixiCanvas`'s twin. Paths, clips and dashes are worked
 * out in canvas pixels as `PixiCanvas` does, then triangulated here (fills by
 * earcut, strokes by `strokeLine`) into batches of triangles, drawn in the
 * order they were made. A box clipped to on screen is a scissor, text comes
 * from a glyph atlas, and `tinted` multiplies the colours as they are laid.
 */

type Matrix = { a: number; b: number; c: number; d: number; e: number; f: number };

interface SubPath {
    readonly points: number[];
    closed: boolean;
}

/** A box on screen, canvas pixels. */
export interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
}

class Pattern {
    m: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    constructor(readonly image: object) {}

    setTransform(m: Partial<Matrix> = {}): void {
        this.m = { a: m.a ?? 1, b: m.b ?? 0, c: m.c ?? 0, d: m.d ?? 1, e: m.e ?? 0, f: m.f ?? 0 };
    }
}

interface State {
    m: Matrix;
    fillStyle: string | Pattern;
    strokeStyle: string | Pattern;
    lineWidth: number;
    globalAlpha: number;
    globalCompositeOperation: string;
    lineCap: "butt" | "round" | "square";
    dash: number[];
    font: string;
    textAlign: string;
    textBaseline: string;
    clips: Clip[];
    scissor: Box | null;
    /** What colours are multiplied by, as `tinted` set them. */
    tint: [number, number, number];
}

const ROUND_CAP_PX = 4;
const ARC_CHORD_PX = 2.5;
const ARC_LEAST_CHORDS = 6;
const MITER_LIMIT = 4;
const KEEP_STEPS = 4;
/** Numbers an effect takes in `ThreeCanvas.effects`. */
export const EFFECT_STRIDE = 6;
const KEPT_MOST = 4000;

/** The effect what is being drawn is part of (`ThreeCanvas.along`), or -1. */
let effectNow = -1;
/** Whether what is being drawn is hidden by what is in front of it (`ThreeCanvas.on`). */
let behindNow = false;

/** Triangles of one kind, drawn in one call. */
export class Batch {
    textured = false;
    texture: Texture | null = null;
    additive = false;
    scissor: Box | null = null;
    /** Drawn on the screen over the battle, rather than in it. */
    screen = false;
    /** Hidden by the models in front of it. */
    behind = false;
    /** Vertices: x, y; r, g, b, a; u, v. */
    pos = new Float32Array(3 * 1024);
    col = new Float32Array(4 * 1024);
    uv = new Float32Array(2 * 1024);
    /** Which of its canvas's `effects` each vertex is part of, or -1. */
    fx = new Int32Array(1024);
    count = 0;

    reset(textured: boolean, texture: Texture | null, additive: boolean, scissor: Box | null): void {
        this.textured = textured;
        this.texture = texture;
        this.additive = additive;
        this.scissor = scissor;
        this.behind = behindNow;
        this.count = 0;
    }

    private room(n: number): void {
        const need = this.count + n;
        if (need * 3 <= this.pos.length) return;
        let size = this.pos.length / 3;
        while (size < need) size *= 2;
        const grow = (old: Float32Array, k: number): Float32Array<ArrayBuffer> => {
            const made = new Float32Array(size * k);
            made.set(old.subarray(0, this.count * k));
            return made;
        };
        this.pos = grow(this.pos, 3);
        this.col = grow(this.col, 4);
        this.uv = grow(this.uv, 2);
        const fx = new Int32Array(size);
        fx.set(this.fx.subarray(0, this.count));
        this.fx = fx;
    }

    vertex(x: number, y: number, r: number, g: number, b: number, a: number, u = 0, v = 0): void {
        this.room(1);
        const i = this.count++;
        this.pos[3 * i] = x;
        this.pos[3 * i + 1] = y;
        this.pos[3 * i + 2] = 0;
        this.col[4 * i] = r;
        this.col[4 * i + 1] = g;
        this.col[4 * i + 2] = b;
        this.col[4 * i + 3] = a;
        this.uv[2 * i] = u;
        this.uv[2 * i + 1] = v;
        this.fx[i] = effectNow;
    }
}

/** A glyph in the atlas: where, and how far it moves the pen, at `ATLAS_PX`. */
interface Glyph {
    u0: number;
    v0: number;
    u1: number;
    v1: number;
    advance: number;
}

const ATLAS_PX = 32;
const ATLAS_SIZE = 1024;
const GLYPH_PAD = 2;
/** The cell a glyph sits in, from above the em box to below it, in ems. */
const CELL_ABOVE = 0.15;
const CELL_BELOW = 0.15;
/** Where the baseline is in the em box, as `anchorY` takes it. */
const BASELINE = 0.8;

/** Glyphs of one font family, rasterised white on demand. */
class GlyphAtlas {
    readonly canvas: HTMLCanvasElement | OffscreenCanvas;
    readonly ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    readonly texture: CanvasTexture;
    private readonly glyphs = new Map<string, Glyph>();
    private x = 0;
    private y = 0;
    private readonly cell = Math.ceil(ATLAS_PX * (1 + CELL_ABOVE + CELL_BELOW));

    constructor(private readonly family: string) {
        this.canvas =
            typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(ATLAS_SIZE, ATLAS_SIZE) : document.createElement("canvas");
        this.canvas.width = ATLAS_SIZE;
        this.canvas.height = ATLAS_SIZE;
        this.ctx = this.canvas.getContext("2d")! as CanvasRenderingContext2D;
        this.texture = new CanvasTexture(this.canvas as HTMLCanvasElement);
        configure(this.texture);
        this.texture.generateMipmaps = true;
        this.clear();
    }

    private clear(): void {
        this.ctx.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
        this.glyphs.clear();
        this.x = 0;
        this.y = 0;
        this.ctx.font = `${ATLAS_PX}px ${this.family}`;
        this.ctx.fillStyle = "#ffffff";
        this.ctx.textBaseline = "alphabetic";
        this.texture.needsUpdate = true;
    }

    get(ch: string): Glyph {
        let glyph = this.glyphs.get(ch);
        if (glyph !== undefined) return glyph;
        const advance = this.ctx.measureText(ch).width;
        const w = Math.ceil(advance) + 2 * GLYPH_PAD;
        if (this.x + w > ATLAS_SIZE) {
            this.x = 0;
            this.y += this.cell;
        }
        if (this.y + this.cell > ATLAS_SIZE) this.clear();
        this.ctx.fillText(ch, this.x + GLYPH_PAD, this.y + ATLAS_PX * (CELL_ABOVE + BASELINE));
        glyph = {
            u0: this.x / ATLAS_SIZE,
            v0: this.y / ATLAS_SIZE,
            u1: (this.x + w) / ATLAS_SIZE,
            v1: (this.y + this.cell) / ATLAS_SIZE,
            advance,
        };
        this.x += w;
        this.glyphs.set(ch, glyph);
        this.texture.needsUpdate = true;
        return glyph;
    }
}

/** A texture as Pixi's are: colours as they are, no flipping, smooth. */
export function configure(texture: Texture): void {
    texture.colorSpace = NoColorSpace;
    texture.flipY = false;
    texture.premultiplyAlpha = false;
    texture.generateMipmaps = false;
    texture.minFilter = LinearFilter;
    texture.magFilter = LinearFilter;
}

/** What `keep` recorded: triangles in the frame they were kept in, by the batch kind they went to. */
interface Kept {
    readonly pieces: { textured: boolean; texture: Texture | null; additive: boolean; data: Float32Array; count: number }[];
}

export class ThreeCanvas {
    private state: State = ThreeCanvas.fresh();
    private readonly saved: State[] = [];
    private path: SubPath[] = [];
    private lastX = 0;
    private lastY = 0;

    /** Batches drawn over everything, in order, and those at deck height, under the thick modules. */
    readonly batches: Batch[] = [];
    readonly deckBatches: Batch[] = [];
    private readonly pool: Batch[] = [];
    private used = 0;
    /** The batch drawing goes into now, or null to start another. */
    private open: Batch | null = null;
    private readonly textures = new WeakMap<object, Texture>();
    private readonly repeating = new WeakMap<object, Texture>();
    private readonly atlases = new Map<string, GlyphAtlas>();
    private measurer: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined;
    /** This view draws ships as solid models itself, so canvas2d.ts leaves their hulls out. */
    readonly solidShips = true;
    /** Whether deck-height drawing has somewhere of its own to go. */
    deck = true;
    /** What canvas2d.ts stands up in 3D through, where the view draws in 3D (render/solid3d.ts). */
    solid3d: Solid3D | null = null;
    /** Each effect's axis, canvas pixels, height, metres, and whether it lies flat: x0, y0, x1, y1, height, lying. */
    readonly effects: number[] = [];

    /** What is drawn from here on is an effect along this axis, in the current transform, at `height` (`Solid3D.along`). */
    along(x0: number, y0: number, x1: number, y1: number, height: number): void {
        const m = this.state.m;
        effectNow = this.effects.length / EFFECT_STRIDE;
        behindNow = false;
        this.effects.push(
            m.a * x0 + m.c * y0 + m.e,
            m.b * x0 + m.d * y0 + m.f,
            m.a * x1 + m.c * y1 + m.e,
            m.b * x1 + m.d * y1 + m.f,
            height,
            0,
        );
    }

    /** What is drawn from here on lies flat at `height`, hidden by what is in front of it (`Solid3D.on`). */
    on(height: number): void {
        effectNow = this.effects.length / EFFECT_STRIDE;
        behindNow = true;
        this.effects.push(0, 0, 0, 0, height, 1);
    }

    flat(): void {
        effectNow = -1;
        behindNow = false;
    }

    private static fresh(): State {
        return {
            m: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
            fillStyle: "#000",
            strokeStyle: "#000",
            lineWidth: 1,
            globalAlpha: 1,
            globalCompositeOperation: "source-over",
            lineCap: "butt",
            dash: [],
            font: "10px sans-serif",
            textAlign: "start",
            textBaseline: "alphabetic",
            clips: [],
            scissor: null,
            tint: [1, 1, 1],
        };
    }

    /** Whether what is drawn now is over the battle on the screen, as a close-up is, rather than in it. */
    private onScreen = false;

    /** Draw on the screen from here, over the battle rather than in it, until called with false. */
    screenSpace(on: boolean): void {
        this.onScreen = on;
        this.open = null;
    }

    begin(): void {
        this.effects.length = 0;
        effectNow = -1;
        behindNow = false;
        this.onScreen = false;
        this.used = 0;
        this.batches.length = 0;
        this.deckBatches.length = 0;
        this.open = null;
        this.state = ThreeCanvas.fresh();
        this.saved.length = 0;
        this.path = [];
        if (this.kept.size > KEPT_MOST) this.kept.clear();
    }

    end(): void {
        this.open = null;
    }

    // State.

    get fillStyle(): string | Pattern {
        return this.state.fillStyle;
    }
    set fillStyle(style: string | Pattern) {
        this.state.fillStyle = style;
    }
    get strokeStyle(): string | Pattern {
        return this.state.strokeStyle;
    }
    set strokeStyle(style: string | Pattern) {
        this.state.strokeStyle = style;
    }
    get lineWidth(): number {
        return this.state.lineWidth;
    }
    set lineWidth(width: number) {
        if (width > 0 && Number.isFinite(width)) this.state.lineWidth = width;
    }
    get globalAlpha(): number {
        return this.state.globalAlpha;
    }
    set globalAlpha(alpha: number) {
        if (alpha >= 0 && alpha <= 1) this.state.globalAlpha = alpha;
    }
    get globalCompositeOperation(): string {
        return this.state.globalCompositeOperation;
    }
    set globalCompositeOperation(op: string) {
        this.state.globalCompositeOperation = op;
    }
    get lineCap(): string {
        return this.state.lineCap;
    }
    set lineCap(cap: "butt" | "round" | "square") {
        this.state.lineCap = cap;
    }
    get font(): string {
        return this.state.font;
    }
    set font(font: string) {
        this.state.font = font;
    }
    get textAlign(): string {
        return this.state.textAlign;
    }
    set textAlign(align: string) {
        this.state.textAlign = align;
    }
    get textBaseline(): string {
        return this.state.textBaseline;
    }
    set textBaseline(baseline: string) {
        this.state.textBaseline = baseline;
    }

    setLineDash(dash: number[]): void {
        this.state.dash = dash.length % 2 === 0 ? [...dash] : [...dash, ...dash];
    }

    save(): void {
        this.saved.push({ ...this.state, m: { ...this.state.m }, clips: [...this.state.clips] });
    }

    tinted(tint: number): void {
        const t = this.state.tint;
        this.state.tint = [(t[0] * ((tint >> 16) & 0xff)) / 255, (t[1] * ((tint >> 8) & 0xff)) / 255, (t[2] * (tint & 0xff)) / 255];
    }

    restore(): void {
        const back = this.saved.pop();
        if (back !== undefined) this.state = back;
    }

    // Transform.

    translate(x: number, y: number): void {
        const m = this.state.m;
        m.e += m.a * x + m.c * y;
        m.f += m.b * x + m.d * y;
    }

    rotate(angle: number): void {
        const m = this.state.m;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const { a, b, c, d } = m;
        m.a = a * cos + c * sin;
        m.b = b * cos + d * sin;
        m.c = c * cos - a * sin;
        m.d = d * cos - b * sin;
    }

    scale(x: number, y: number): void {
        const m = this.state.m;
        m.a *= x;
        m.b *= x;
        m.c *= y;
        m.d *= y;
    }

    transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
        const m = this.state.m;
        const { a: ma, b: mb, c: mc, d: md } = m;
        m.e += ma * e + mc * f;
        m.f += mb * e + md * f;
        m.a = ma * a + mc * b;
        m.b = mb * a + md * b;
        m.c = ma * c + mc * d;
        m.d = mb * c + md * d;
    }

    setTransform(a: number | Matrix, b?: number, c?: number, d?: number, e?: number, f?: number): void {
        this.state.m =
            typeof a === "number" ? { a, b: b!, c: c!, d: d!, e: e!, f: f! } : { a: a.a, b: a.b, c: a.c, d: a.d, e: a.e, f: a.f };
    }

    getTransform(): Matrix {
        return { ...this.state.m };
    }

    // Paths.

    beginPath(): void {
        this.path = [];
    }

    moveTo(x: number, y: number): void {
        const m = this.state.m;
        this.path.push({ points: [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f], closed: false });
        this.lastX = x;
        this.lastY = y;
    }

    lineTo(x: number, y: number): void {
        const current = this.path[this.path.length - 1];
        if (current === undefined) return this.moveTo(x, y);
        const m = this.state.m;
        current.points.push(m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f);
        this.lastX = x;
        this.lastY = y;
    }

    closePath(): void {
        const current = this.path[this.path.length - 1];
        if (current === undefined) return;
        current.closed = true;
        this.path.push({ points: [current.points[0]!, current.points[1]!], closed: false });
    }

    rect(x: number, y: number, w: number, h: number): void {
        this.moveTo(x, y);
        this.lineTo(x + w, y);
        this.lineTo(x + w, y + h);
        this.lineTo(x, y + h);
        this.closePath();
    }

    roundRect(x: number, y: number, w: number, h: number, radius: number): void {
        const r = Math.max(0, Math.min(radius, Math.abs(w) / 2, Math.abs(h) / 2));
        if (r === 0) return this.rect(x, y, w, h);
        this.moveTo(x + r, y);
        this.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
        this.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
        this.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
        this.arc(x + r, y + r, r, Math.PI, (3 * Math.PI) / 2);
        this.closePath();
    }

    arc(x: number, y: number, r: number, from: number, to: number, anticlockwise = false): void {
        this.ellipse(x, y, r, r, 0, from, to, anticlockwise);
    }

    ellipse(x: number, y: number, rx: number, ry: number, rotation: number, from: number, to: number, anticlockwise = false): void {
        const sweep = arcSweep(from, to, anticlockwise);
        const radius = Math.max(rx, ry) * this.scaleOf();
        const n = Math.min(
            256,
            Math.max(Math.abs(sweep) >= 2 * Math.PI - 1e-9 ? ARC_LEAST_CHORDS : 1, Math.ceil((Math.abs(sweep) * radius) / ARC_CHORD_PX)),
        );
        const cr = Math.cos(rotation);
        const sr = Math.sin(rotation);
        for (let k = 0; k <= n; k++) {
            const t = from + (sweep * k) / n;
            const ex = rx * Math.cos(t);
            const ey = ry * Math.sin(t);
            const px = x + ex * cr - ey * sr;
            const py = y + ex * sr + ey * cr;
            if (k === 0 && this.path.length === 0) this.moveTo(px, py);
            else this.lineTo(px, py);
        }
    }

    arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void {
        const x0 = this.lastX;
        const y0 = this.lastY;
        const ux = x0 - x1;
        const uy = y0 - y1;
        const vx = x2 - x1;
        const vy = y2 - y1;
        const lu = Math.hypot(ux, uy);
        const lv = Math.hypot(vx, vy);
        const cross = ux * vy - uy * vx;
        if (lu === 0 || lv === 0 || r === 0 || Math.abs(cross) < 1e-12) return this.lineTo(x1, y1);
        const angle = Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (lu * lv))));
        const along = r / Math.tan(angle / 2);
        const t1x = x1 + (ux / lu) * along;
        const t1y = y1 + (uy / lu) * along;
        const t2x = x1 + (vx / lv) * along;
        const t2y = y1 + (vy / lv) * along;
        const bx = ux / lu + vx / lv;
        const by = uy / lu + vy / lv;
        const lb = Math.hypot(bx, by);
        const reach = r / Math.sin(angle / 2);
        const cx = x1 + (bx / lb) * reach;
        const cy = y1 + (by / lb) * reach;
        this.lineTo(t1x, t1y);
        this.arc(cx, cy, r, Math.atan2(t1y - cy, t1x - cx), Math.atan2(t2y - cy, t2x - cx), cross > 0);
    }

    // Drawing.

    createPattern(image: object): Pattern {
        return new Pattern(image);
    }

    fill(): void {
        this.fillPath(this.path, this.state.fillStyle);
    }

    stroke(): void {
        this.strokePath(this.path);
    }

    fillRect(x: number, y: number, w: number, h: number): void {
        const kept = this.path;
        this.path = [];
        this.rect(x, y, w, h);
        this.fill();
        this.path = kept;
    }

    strokeRect(x: number, y: number, w: number, h: number): void {
        const kept = this.path;
        this.path = [];
        this.rect(x, y, w, h);
        this.stroke();
        this.path = kept;
    }

    clearRect(): void {}

    clip(rule: "nonzero" | "evenodd" = "nonzero"): void {
        const shapes = this.path.filter((sub) => sub.points.length >= 6).map((sub) => sub.points);
        if (shapes.length === 0) return;
        if (rule === "evenodd" && shapes.length === 2) {
            this.state.clips = [...this.state.clips, { inside: false, polys: [convexHullOrder(shapes[1]!)] }];
            return;
        }
        const box = shapes.length === 1 && this.state.clips.length === 0 && this.recorder === null ? screenRect(shapes[0]!) : null;
        if (box !== null) {
            const was = this.state.scissor;
            this.state.scissor =
                was === null
                    ? { x: box.x, y: box.y, width: box.width, height: box.height }
                    : intersect(was, { x: box.x, y: box.y, width: box.width, height: box.height });
            return;
        }
        this.state.clips = [...this.state.clips, { inside: true, polys: shapes.map(convexHullOrder) }];
    }

    drawImage(image: object, ...args: number[]): void {
        const texture = this.textureOf(image);
        const iw = (image as { width: number }).width;
        const ih = (image as { height: number }).height;
        const [sx = 0, sy = 0, sw = 0, sh = 0, dx = 0, dy = 0, dw = 0, dh = 0] =
            args.length === 2 ? [0, 0, iw, ih, args[0]!, args[1]!, iw, ih] : args.length === 4 ? [0, 0, iw, ih, ...args] : args;
        const a = this.state.globalAlpha;
        if (a <= 0) return;
        const batch = this.batch(true, texture, this.additive());
        const [r, g, b] = this.state.tint;
        const m = this.state.m;
        const u0 = sx / iw;
        const v0 = sy / ih;
        const u1 = (sx + sw) / iw;
        const v1 = (sy + sh) / ih;
        const put = (x: number, y: number, u: number, v: number): void =>
            batch.vertex(m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f, r, g, b, a, u, v);
        put(dx, dy, u0, v0);
        put(dx + dw, dy, u1, v0);
        put(dx + dw, dy + dh, u1, v1);
        put(dx, dy, u0, v0);
        put(dx + dw, dy + dh, u1, v1);
        put(dx, dy + dh, u0, v1);
    }

    /** A batch of particles drawing `image`, in order among the rest, or with what is at deck height if `onDeck`. */
    particles(image: object, additive: boolean, onDeck = false): ThreeParticles {
        const batch = this.nextBatch(true, this.textureOf(image), additive, onDeck);
        this.open = null;
        return new ThreeParticles(batch, this.state.m, this.state.globalAlpha, this.state.tint);
    }

    measureText(text: string): { width: number } {
        if (this.measurer === undefined) {
            this.measurer = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(1, 1).getContext("2d") : null;
        }
        if (this.measurer === null) return { width: fontSize(this.state.font) * 0.6 * text.length };
        this.measurer.font = this.state.font;
        return this.measurer.measureText(text);
    }

    fillText(text: string, x: number, y: number): void {
        if (typeof this.state.fillStyle !== "string") return;
        const [rgb, alpha] = parseColour(this.state.fillStyle);
        const a = alpha * this.state.globalAlpha;
        if (a <= 0) return;
        const family = fontFamily(this.state.font);
        let atlas = this.atlases.get(family);
        if (atlas === undefined) {
            atlas = new GlyphAtlas(family);
            this.atlases.set(family, atlas);
        }
        const size = fontSize(this.state.font);
        const k = size / ATLAS_PX;
        const glyphs = [...text].map((ch) => atlas.get(ch));
        const width = glyphs.reduce((sum, g) => sum + g.advance, 0) * k;
        const left = x - anchorX(this.state.textAlign) * width;
        const top = y - anchorY(this.state.textBaseline) * size;
        const [tr, tg, tb] = this.state.tint;
        const r = (((rgb >> 16) & 0xff) / 255) * tr;
        const g = (((rgb >> 8) & 0xff) / 255) * tg;
        const b = ((rgb & 0xff) / 255) * tb;
        const batch = this.batch(true, atlas.texture, this.additive());
        const m = this.state.m;
        const put = (px: number, py: number, u: number, v: number): void =>
            batch.vertex(m.a * px + m.c * py + m.e, m.b * px + m.d * py + m.f, r, g, b, a, u, v);
        let pen = left;
        for (const glyph of glyphs) {
            const x0 = pen - GLYPH_PAD * k;
            const x1 = x0 + (glyph.u1 - glyph.u0) * ATLAS_SIZE * k;
            const y0 = top - CELL_ABOVE * size;
            const y1 = y0 + (glyph.v1 - glyph.v0) * ATLAS_SIZE * k;
            put(x0, y0, glyph.u0, glyph.v0);
            put(x1, y0, glyph.u1, glyph.v0);
            put(x1, y1, glyph.u1, glyph.v1);
            put(x0, y0, glyph.u0, glyph.v0);
            put(x1, y1, glyph.u1, glyph.v1);
            put(x0, y1, glyph.u0, glyph.v1);
            pen += glyph.advance * k;
        }
    }

    /**
     * What `draw` paints, kept: triangulated the first time `key` is drawn at
     * about this scale, and only placed every time after (`PixiCanvas.keep`).
     */
    keep(key: string, draw: () => void): void {
        const st = this.state;
        const m = st.m;
        const det = m.a * m.d - m.b * m.c;
        if (st.clips.length > 0 || st.globalCompositeOperation !== "source-over" || this.recorder !== null || det === 0) return draw();
        const scale = 2 ** (Math.round(Math.log2(Math.sqrt(Math.abs(det))) * KEEP_STEPS) / KEEP_STEPS);
        const flip = det < 0 ? -1 : 1;
        const at = `${key}@${scale}${flip < 0 ? "-" : ""}@${st.globalAlpha}`;
        let kept = this.kept.get(at);
        if (kept === undefined) {
            kept = this.record(draw, scale, flip);
            this.kept.set(at, kept);
        }
        const pa = m.a / scale;
        const pb = m.b / scale;
        const pc = m.c / (scale * flip);
        const pd = m.d / (scale * flip);
        const [tr, tg, tb] = st.tint;
        for (const piece of kept.pieces) {
            const batch = this.batch(piece.textured, piece.texture, piece.additive);
            const d = piece.data;
            for (let v = 0; v < piece.count; v++) {
                const o = v * 8;
                const x = d[o]!;
                const y = d[o + 1]!;
                batch.vertex(
                    pa * x + pc * y + m.e,
                    pb * x + pd * y + m.f,
                    d[o + 2]! * tr,
                    d[o + 3]! * tg,
                    d[o + 4]! * tb,
                    d[o + 5]!,
                    d[o + 6]!,
                    d[o + 7]!,
                );
            }
        }
    }

    private readonly kept = new Map<string, Kept>();
    private recorder: Batch[] | null = null;

    private record(draw: () => void, scale: number, flip: number): Kept {
        const recorded: Batch[] = [];
        const outer = this.open;
        const path = this.path;
        this.save();
        this.setTransform(scale, 0, 0, scale * flip, 0, 0);
        this.state.tint = [1, 1, 1];
        this.state.scissor = null;
        this.recorder = recorded;
        this.open = null;
        this.path = [];
        try {
            draw();
        } finally {
            this.recorder = null;
            this.restore();
            this.open = outer;
            this.path = path;
        }
        return {
            pieces: recorded.map((b) => {
                const data = new Float32Array(b.count * 8);
                for (let v = 0; v < b.count; v++) {
                    data.set([b.pos[3 * v]!, b.pos[3 * v + 1]!], v * 8);
                    data.set(b.col.subarray(4 * v, 4 * v + 4), v * 8 + 2);
                    data.set(b.uv.subarray(2 * v, 2 * v + 2), v * 8 + 6);
                }
                return { textured: b.textured, texture: b.texture, additive: b.additive, data, count: b.count };
            }),
        };
    }

    // Internals.

    private scaleOf(): number {
        const m = this.state.m;
        return Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
    }

    private additive(): boolean {
        return this.state.globalCompositeOperation === "lighter";
    }

    /** The batch to add triangles of this kind to: the open one if it is of the kind, else a new one. */
    private batch(textured: boolean, texture: Texture | null, additive: boolean): Batch {
        const scissor = this.state.scissor;
        const open = this.open;
        if (
            open !== null &&
            open.textured === textured &&
            open.texture === texture &&
            open.additive === additive &&
            open.behind === behindNow &&
            sameBox(open.scissor, scissor)
        ) {
            return open;
        }
        return (this.open = this.nextBatch(textured, texture, additive, false));
    }

    private nextBatch(textured: boolean, texture: Texture | null, additive: boolean, onDeck: boolean): Batch {
        if (this.recorder !== null) {
            const made = new Batch();
            made.reset(textured, texture, additive, null);
            this.recorder.push(made);
            return made;
        }
        let batch = this.pool[this.used];
        if (batch === undefined) {
            batch = new Batch();
            this.pool.push(batch);
        }
        this.used++;
        batch.reset(textured, texture, additive, this.state.scissor === null ? null : { ...this.state.scissor });
        batch.screen = this.onScreen;
        (onDeck && this.deck ? this.deckBatches : this.batches).push(batch);
        return batch;
    }

    textureOf(image: object): Texture {
        let texture = this.textures.get(image);
        if (texture === undefined) {
            texture = new CanvasTexture(image as HTMLCanvasElement);
            configure(texture);
            this.textures.set(image, texture);
        }
        return texture;
    }

    private repeatingOf(image: object): Texture {
        let texture = this.repeating.get(image);
        if (texture === undefined) {
            texture = new CanvasTexture(image as HTMLCanvasElement);
            configure(texture);
            texture.wrapS = RepeatWrapping;
            texture.wrapT = RepeatWrapping;
            this.repeating.set(image, texture);
        }
        return texture;
    }

    private fillPath(path: SubPath[], style: string | Pattern): void {
        if (style instanceof Pattern) return this.fillPattern(path, style);
        const [rgb, alpha] = parseColour(style);
        const a = alpha * this.state.globalAlpha;
        if (a <= 0) return;
        const [tr, tg, tb] = this.state.tint;
        const r = (((rgb >> 16) & 0xff) / 255) * tr;
        const g = (((rgb >> 8) & 0xff) / 255) * tg;
        const b = ((rgb & 0xff) / 255) * tb;
        for (const sub of path) {
            if (sub.points.length < 6) continue;
            for (const piece of clipPolygon(sub.points, this.state.clips)) {
                if (piece.length < 6) continue;
                const batch = this.batch(false, null, this.additive());
                triangulate(piece, (x, y) => batch.vertex(x, y, r, g, b, a));
            }
        }
    }

    private fillPattern(path: SubPath[], pattern: Pattern): void {
        const a = this.state.globalAlpha;
        if (a <= 0) return;
        const texture = this.repeatingOf(pattern.image);
        const iw = (pattern.image as { width: number }).width;
        const ih = (pattern.image as { height: number }).height;
        const s = this.state.m;
        const p = pattern.m;
        // Tile pixels to canvas pixels, and back.
        const ma = s.a * p.a + s.c * p.b;
        const mb = s.b * p.a + s.d * p.b;
        const mc = s.a * p.c + s.c * p.d;
        const md = s.b * p.c + s.d * p.d;
        const me = s.a * p.e + s.c * p.f + s.e;
        const mf = s.b * p.e + s.d * p.f + s.f;
        const det = ma * md - mb * mc;
        if (det === 0) return;
        const [r, g, b] = this.state.tint;
        for (const sub of path) {
            if (sub.points.length < 6) continue;
            for (const piece of clipPolygon(sub.points, this.state.clips)) {
                if (piece.length < 6) continue;
                const batch = this.batch(true, texture, this.additive());
                triangulate(piece, (x, y) => {
                    const dx = x - me;
                    const dy = y - mf;
                    const tx = (md * dx - mc * dy) / det;
                    const ty = (-mb * dx + ma * dy) / det;
                    batch.vertex(x, y, r, g, b, a, tx / iw, ty / ih);
                });
            }
        }
    }

    private strokePath(path: SubPath[]): void {
        const style = this.state.strokeStyle;
        if (typeof style !== "string") return;
        const [rgb, alpha] = parseColour(style);
        let width = this.state.lineWidth * this.scaleOf();
        let a = alpha * this.state.globalAlpha;
        if (width < 1) {
            a *= width;
            width = 1;
        }
        if (a <= 0) return;
        const [tr, tg, tb] = this.state.tint;
        const r = (((rgb >> 16) & 0xff) / 255) * tr;
        const g = (((rgb >> 8) & 0xff) / 255) * tg;
        const b = ((rgb & 0xff) / 255) * tb;
        const dash = this.state.dash.map((d) => d * this.scaleOf());
        const cap = this.state.lineCap === "round" && width < ROUND_CAP_PX ? "square" : this.state.lineCap;
        for (const sub of path) {
            if (sub.points.length < 4) continue;
            const line = sub.closed ? [...sub.points, sub.points[0]!, sub.points[1]!] : sub.points;
            const pieces = dash.length > 0 && dash.some((d) => d > 0) ? dashed(line, dash) : [line];
            for (const piece of pieces) {
                for (const kept of clipPolyline(piece, this.state.clips)) {
                    if (kept.length < 4) continue;
                    const batch = this.batch(false, null, this.additive());
                    const closed = sub.closed && pieces.length === 1 && kept === piece;
                    strokeLine(closed ? kept.slice(0, -2) : kept, closed, width / 2, cap, (x, y) => batch.vertex(x, y, r, g, b, a));
                }
            }
        }
    }
}

/** Particles of one texture, in one batch, placed in the frame the batch was started under. */
export class ThreeParticles {
    private readonly m: Matrix;
    private readonly scale: number;

    constructor(
        private readonly batch: Batch,
        m: Matrix,
        private readonly alpha: number,
        private readonly tint: readonly number[],
    ) {
        this.m = { ...m };
        this.scale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
    }

    add(x: number, y: number, dirX: number, dirY: number, length: number, width: number, tint: number, alpha: number): void {
        const m = this.m;
        const cx = m.a * x + m.c * y + m.e;
        const cy = m.b * x + m.d * y + m.f;
        let ux = m.a * dirX + m.c * dirY;
        let uy = m.b * dirX + m.d * dirY;
        const n = Math.hypot(ux, uy) || 1;
        ux /= n;
        uy /= n;
        const hl = (length * this.scale) / 2;
        const hw = (width * this.scale) / 2;
        const r = (((tint >> 16) & 0xff) / 255) * this.tint[0]!;
        const g = (((tint >> 8) & 0xff) / 255) * this.tint[1]!;
        const b = ((tint & 0xff) / 255) * this.tint[2]!;
        const a = alpha * this.alpha;
        const put = (s: number, t: number, u: number, v: number): void =>
            this.batch.vertex(cx + ux * s - uy * t, cy + uy * s + ux * t, r, g, b, a, u, v);
        put(-hl, -hw, 0, 0);
        put(hl, -hw, 1, 0);
        put(hl, hw, 1, 1);
        put(-hl, -hw, 0, 0);
        put(hl, hw, 1, 1);
        put(-hl, hw, 0, 1);
    }

    end(): void {}
}

function sameBox(p: Box | null, q: Box | null): boolean {
    if (p === null || q === null) return p === q;
    return p.x === q.x && p.y === q.y && p.width === q.width && p.height === q.height;
}

function intersect(p: Box, q: Box): Box {
    const x = Math.max(p.x, q.x);
    const y = Math.max(p.y, q.y);
    const right = Math.min(p.x + p.width, q.x + q.width);
    const bottom = Math.min(p.y + p.height, q.y + q.height);
    return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

/** Whether polygon `points` is convex, either way round. */
function isConvex(points: readonly number[]): boolean {
    const n = points.length / 2;
    if (n <= 3) return true;
    let sign = 0;
    for (let k = 0; k < n; k++) {
        const i = 2 * k;
        const j = 2 * ((k + 1) % n);
        const l = 2 * ((k + 2) % n);
        const cross =
            (points[j]! - points[i]!) * (points[l + 1]! - points[j + 1]!) - (points[j + 1]! - points[i + 1]!) * (points[l]! - points[j]!);
        if (cross === 0) continue;
        const s = cross > 0 ? 1 : -1;
        if (sign === 0) sign = s;
        else if (s !== sign) return false;
    }
    return true;
}

/** Polygon `points` as triangles, each corner handed to `put` in turn. */
export function triangulate(points: readonly number[], put: (x: number, y: number) => void): void {
    const n = points.length / 2;
    if (isConvex(points)) {
        for (let k = 1; k + 1 < n; k++) {
            put(points[0]!, points[1]!);
            put(points[2 * k]!, points[2 * k + 1]!);
            put(points[2 * k + 2]!, points[2 * k + 3]!);
        }
        return;
    }
    const indices = earcut(points as number[]);
    for (const i of indices) put(points[2 * i]!, points[2 * i + 1]!);
}

/**
 * A line `half` either side of polyline `points`, as triangles: a quad a
 * segment, mitred joins (bevelled past `MITER_LIMIT`) and the caps asked for.
 */
export function strokeLine(
    points: readonly number[],
    closed: boolean,
    half: number,
    cap: "butt" | "round" | "square",
    put: (x: number, y: number) => void,
): void {
    // Corners a hair apart are one, so no segment is left without a direction.
    const p: number[] = [];
    for (let k = 0; k < points.length; k += 2) {
        const n = p.length;
        if (n >= 2 && Math.abs(points[k]! - p[n - 2]!) < 1e-6 && Math.abs(points[k + 1]! - p[n - 1]!) < 1e-6) continue;
        p.push(points[k]!, points[k + 1]!);
    }
    // A closed line's last corner on its first would leave a segment with no direction.
    while (closed && p.length >= 4 && Math.abs(p[0]! - p[p.length - 2]!) < 1e-6 && Math.abs(p[1]! - p[p.length - 1]!) < 1e-6) p.length -= 2;
    const n = p.length / 2;
    if (n < 2) return;
    const tri = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number): void => {
        put(ax, ay);
        put(bx, by);
        put(cx, cy);
    };
    const segments = closed ? n : n - 1;
    const normal = (k: number): [number, number] => {
        const i = 2 * (k % n);
        const j = 2 * ((k + 1) % n);
        const dx = p[j]! - p[i]!;
        const dy = p[j + 1]! - p[i + 1]!;
        const l = Math.hypot(dx, dy);
        return [(-dy / l) * half, (dx / l) * half];
    };
    for (let k = 0; k < segments; k++) {
        const i = 2 * k;
        const j = 2 * ((k + 1) % n);
        const [nx, ny] = normal(k);
        let ax = p[i]!;
        let ay = p[i + 1]!;
        let bx = p[j]!;
        let by = p[j + 1]!;
        if (!closed && cap === "square") {
            const tx = ny;
            const ty = -nx;
            if (k === 0) {
                ax -= tx;
                ay -= ty;
            }
            if (k === segments - 1) {
                bx += tx;
                by += ty;
            }
        }
        tri(ax + nx, ay + ny, bx + nx, by + ny, bx - nx, by - ny);
        tri(ax + nx, ay + ny, bx - nx, by - ny, ax - nx, ay - ny);
        // The join at its far end.
        if (closed || k < segments - 1) {
            const [mx, my] = normal(k + 1);
            const cross = nx * my - ny * mx;
            if (Math.abs(cross) < 1e-9) continue;
            // The outer side is where the normals spread apart.
            const s = cross > 0 ? -1 : 1;
            const ox = bx + s * nx;
            const oy = by + s * ny;
            const qx = bx + s * mx;
            const qy = by + s * my;
            const sx = nx + mx;
            const sy = ny + my;
            const sl = Math.hypot(sx, sy);
            if (sl > 0 && (2 * half) / sl <= MITER_LIMIT) {
                const mlen = (2 * half * half) / sl;
                const tx = bx + (s * sx * mlen) / sl;
                const ty = by + (s * sy * mlen) / sl;
                tri(bx, by, ox, oy, tx, ty);
                tri(bx, by, tx, ty, qx, qy);
            } else {
                tri(bx, by, ox, oy, qx, qy);
            }
        }
    }
    if (!closed && cap === "round") {
        const end = (cx: number, cy: number, nx: number, ny: number, outward: number): void => {
            const steps = Math.max(4, Math.ceil((Math.PI * half) / ARC_CHORD_PX));
            const start = Math.atan2(ny, nx);
            for (let k = 0; k < steps; k++) {
                const t0 = start + (outward * Math.PI * k) / steps;
                const t1 = start + (outward * Math.PI * (k + 1)) / steps;
                tri(cx, cy, cx + Math.cos(t0) * half, cy + Math.sin(t0) * half, cx + Math.cos(t1) * half, cy + Math.sin(t1) * half);
            }
        };
        const [n0x, n0y] = normal(0);
        end(p[0]!, p[1]!, n0x, n0y, 1);
        const [n1x, n1y] = normal(n - 2);
        end(p[2 * n - 2]!, p[2 * n - 1]!, n1x, n1y, -1);
    }
}

/** Meshes kept from frame to frame, one a batch, filled afresh each frame. */
export class BatchMeshes {
    private readonly meshes: Mesh[] = [];
    private readonly materials = new Map<string, MeshBasicMaterial>();
    private used = 0;

    begin(): void {
        this.used = 0;
    }

    /**
     * Put `batch` into the next mesh, under `parent`, drawn `order`th; with its
     * scissor, if it has one, set by `scissor` as it is drawn.
     */
    add(batch: Batch, parent: Object3D, order: number, scissor: (box: Box | null, renderer: WebGLRenderer) => void): Mesh | null {
        if (batch.count === 0) return null;
        let mesh = this.meshes[this.used];
        if (mesh === undefined) {
            mesh = new Mesh(new BufferGeometry());
            mesh.frustumCulled = false;
            mesh.matrixAutoUpdate = false;
            this.meshes.push(mesh);
        }
        this.used++;
        uploadBatch(mesh, batch);
        mesh.material = this.material(batch);
        mesh.renderOrder = order;
        const box = batch.scissor;
        mesh.onBeforeRender = (renderer) => scissor(box, renderer);
        mesh.onAfterRender = (renderer) => scissor(null, renderer);
        parent.add(mesh);
        return mesh;
    }

    private material(batch: Batch): MeshBasicMaterial {
        const key = `${batch.textured ? batch.texture!.id : "-"}|${batch.additive}|${batch.behind}`;
        let material = this.materials.get(key);
        if (material === undefined) {
            material = new MeshBasicMaterial({
                vertexColors: true,
                transparent: true,
                depthTest: batch.behind,
                depthWrite: false,
                side: DoubleSide,
                map: batch.textured ? batch.texture : null,
                blending: batch.additive ? AdditiveBlending : NormalBlending,
            });
            this.materials.set(key, material);
        }
        return material;
    }
}

/** `batch`'s triangles into `mesh`'s geometry, grown as needed. */
export function uploadBatch(mesh: Mesh, batch: Batch): void {
    const geometry = mesh.geometry;
    const size = batch.pos.length / 3;
    const position = geometry.getAttribute("position") as BufferAttribute | undefined;
    if (position === undefined || position.count < size) {
        geometry.setAttribute("position", new BufferAttribute(new Float32Array(size * 3), 3));
        geometry.setAttribute("color", new BufferAttribute(new Float32Array(size * 4), 4));
        geometry.setAttribute("uv", new BufferAttribute(new Float32Array(size * 2), 2));
    }
    const put = (name: string, from: Float32Array, k: number): void => {
        const attribute = geometry.getAttribute(name) as BufferAttribute;
        (attribute.array as Float32Array).set(from.subarray(0, batch.count * k));
        attribute.clearUpdateRanges();
        attribute.addUpdateRange(0, batch.count * k);
        attribute.needsUpdate = true;
    };
    put("position", batch.pos, 3);
    put("color", batch.col, 4);
    put("uv", batch.uv, 2);
    geometry.setDrawRange(0, batch.count);
}

/** Canvas pixels on a canvas `width` by `height` to metres from the camera, y up, at `scale` pixels to the metre. */
export function pixelsToMetres(out: Matrix4, width: number, height: number, scale: number, z = 0): Matrix4 {
    return out.set(1 / scale, 0, 0, -width / 2 / scale, 0, -1 / scale, 0, height / 2 / scale, 0, 0, 1, z, 0, 0, 0, 1);
}
