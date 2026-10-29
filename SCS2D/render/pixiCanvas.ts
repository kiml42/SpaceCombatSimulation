import { BitmapText, Container, Graphics, Rectangle, Texture } from "pixi.js";

/**
 * The parts of a Canvas2D context that canvas2d.ts draws the battle with,
 * drawn into Pixi instead, so the same drawing code paints the Pixi scene in
 * its true order. Paths are worked out here, in canvas pixels and in doubles,
 * and handed to Pixi as polygons and polylines; everything is rebuilt each
 * frame between `begin` and `end`.
 *
 * Where Pixi has no equivalent it is approximated: gradients are filled in
 * bands, a clip is cut geometrically (a convex region, or the outside of one)
 * or, for a rectangle on screen, masked, and text is `BitmapText`.
 */

type Matrix = { a: number; b: number; c: number; d: number; e: number; f: number };

interface SubPath {
    /** Corners in canvas pixels, x, y pairs. */
    readonly points: number[];
    closed: boolean;
}

/** Where drawing may go: inside one of `polys` (a union), or outside the one. */
interface Clip {
    readonly inside: boolean;
    readonly polys: number[][];
}

interface Stop {
    readonly offset: number;
    readonly rgb: number;
    readonly alpha: number;
}

/** A gradient as canvas2d.ts makes them, filled in bands rather than smoothly. */
class Gradient {
    readonly stops: Stop[] = [];
    constructor(
        readonly radial: boolean,
        /** Linear: from x0, y0 to x1, y1. Radial: about x1, y1 out to r1, as canvas2d.ts uses it. */
        readonly x0: number,
        readonly y0: number,
        readonly x1: number,
        readonly y1: number,
        readonly r1 = 0,
    ) {}

    addColorStop(offset: number, colour: string): void {
        const [rgb, alpha] = parseColour(colour);
        this.stops.push({ offset, rgb, alpha });
        this.stops.sort((p, q) => p.offset - q.offset);
    }

    /** The colour at `t` along it. */
    at(t: number): [number, number] {
        const stops = this.stops;
        if (stops.length === 0) return [0, 0];
        if (t <= stops[0]!.offset) return [stops[0]!.rgb, stops[0]!.alpha];
        for (let k = 1; k < stops.length; k++) {
            const q = stops[k]!;
            if (t > q.offset) continue;
            const p = stops[k - 1]!;
            const u = q.offset > p.offset ? (t - p.offset) / (q.offset - p.offset) : 0;
            return [mixRgb(p.rgb, q.rgb, u), p.alpha + (q.alpha - p.alpha) * u];
        }
        const last = stops[stops.length - 1]!;
        return [last.rgb, last.alpha];
    }
}

/** How many bands a gradient is filled in. */
const GRADIENT_BANDS = 12;
/** Canvas pixels an arc's chord spans at most. */
const ARC_CHORD_PX = 2.5;
/** Font size glyphs are rasterised at, and scaled from. */
const GLYPH_PX = 32;

interface State {
    m: Matrix;
    fillStyle: string | Gradient;
    strokeStyle: string | Gradient;
    lineWidth: number;
    globalAlpha: number;
    globalCompositeOperation: string;
    lineCap: "butt" | "round" | "square";
    dash: number[];
    font: string;
    textAlign: string;
    textBaseline: string;
    clips: Clip[];
    /** How many masked containers deep drawing is. */
    masks: number;
}

/** Makes the display object `fillText` draws, so tests can do without fonts. */
export type TextMaker = () => BitmapText;

export class PixiCanvas {
    /** Everything drawn since `begin`, in order. */
    readonly root = new Container();
    private state: State = PixiCanvas.fresh();
    private readonly saved: State[] = [];
    private path: SubPath[] = [];
    /** The last point added, in the frame it was given in, for `arcTo`. */
    private lastX = 0;
    private lastY = 0;

    private readonly targets: Container[] = [];
    private graphics: Graphics | null = null;
    private readonly graphicsPool: Graphics[] = [];
    private graphicsUsed = 0;
    private readonly maskPool: { box: Container; mask: Graphics }[] = [];
    private masksUsed = 0;
    private readonly textPool: BitmapText[] = [];
    private textsUsed = 0;
    private readonly textures = new WeakMap<object, Texture>();
    private measurer: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined;

    constructor(private readonly makeText: TextMaker = () => new BitmapText({ style: { fontSize: GLYPH_PX, fill: 0xffffff } })) {}

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
            masks: 0,
        };
    }

    /** Start a frame: what was drawn last frame is cleared, its objects kept for reuse. */
    begin(): void {
        this.root.removeChildren();
        for (let k = 0; k < this.graphicsUsed; k++) this.graphicsPool[k]!.clear();
        for (let k = 0; k < this.masksUsed; k++) {
            const { box, mask } = this.maskPool[k]!;
            box.removeChildren();
            mask.clear();
        }
        this.graphicsUsed = 0;
        this.masksUsed = 0;
        this.textsUsed = 0;
        this.state = PixiCanvas.fresh();
        this.saved.length = 0;
        this.targets.length = 0;
        this.targets.push(this.root);
        this.graphics = null;
        this.path = [];
    }

    // State.

    get fillStyle(): string | Gradient {
        return this.state.fillStyle;
    }
    set fillStyle(style: string | Gradient) {
        this.state.fillStyle = style;
    }
    get strokeStyle(): string | Gradient {
        return this.state.strokeStyle;
    }
    set strokeStyle(style: string | Gradient) {
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
        if (op !== this.state.globalCompositeOperation) this.graphics = null;
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

    restore(): void {
        const back = this.saved.pop();
        if (back === undefined) return;
        if (back.globalCompositeOperation !== this.state.globalCompositeOperation) this.graphics = null;
        while (this.state.masks > back.masks) {
            this.targets.pop();
            this.state.masks--;
            this.graphics = null;
        }
        this.state = back;
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
        const [px, py] = this.apply(x, y);
        this.path.push({ points: [px, py], closed: false });
        this.lastX = x;
        this.lastY = y;
    }

    lineTo(x: number, y: number): void {
        const current = this.path[this.path.length - 1];
        if (current === undefined) return this.moveTo(x, y);
        const [px, py] = this.apply(x, y);
        current.points.push(px, py);
        this.lastX = x;
        this.lastY = y;
    }

    closePath(): void {
        const current = this.path[this.path.length - 1];
        if (current === undefined) return;
        current.closed = true;
        // As a canvas does: the next segment starts where this one began.
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
            Math.max(Math.abs(sweep) >= 2 * Math.PI - 1e-9 ? 12 : 1, Math.ceil((Math.abs(sweep) * radius) / ARC_CHORD_PX)),
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

    createLinearGradient(x0: number, y0: number, x1: number, y1: number): Gradient {
        return new Gradient(false, x0, y0, x1, y1);
    }

    /** Concentric and from the centre, as canvas2d.ts makes them: only the outer circle is kept. */
    createRadialGradient(_x0: number, _y0: number, _r0: number, x1: number, y1: number, r1: number): Gradient {
        return new Gradient(true, x1, y1, x1, y1, r1);
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

    /** Nothing is painted under Pixi's own drawing, so there is nothing to clear. */
    clearRect(): void {}

    clip(rule: "nonzero" | "evenodd" = "nonzero"): void {
        const shapes = this.path.filter((sub) => sub.points.length >= 6).map((sub) => sub.points);
        if (shapes.length === 0) return;
        if (rule === "evenodd" && shapes.length === 2) {
            // The outside of the second shape, within the first: a hull mount's block cut out of the view.
            this.state.clips = [...this.state.clips, { inside: false, polys: [convexHullOrder(shapes[1]!)] }];
            return;
        }
        const box = shapes.length === 1 && this.state.clips.length === 0 ? screenRect(shapes[0]!) : null;
        if (box !== null) {
            // A box on screen, round a close-up or a strip's tile: masked, so sprites are cut too.
            const masked = this.nextMask();
            masked.mask.rect(box.x, box.y, box.width, box.height).fill(0xffffff);
            this.target().addChild(masked.mask, masked.box);
            masked.box.mask = masked.mask;
            this.targets.push(masked.box);
            this.state.masks++;
            this.graphics = null;
            return;
        }
        this.state.clips = [...this.state.clips, { inside: true, polys: shapes.map(convexHullOrder) }];
    }

    drawImage(image: object, ...args: number[]): void {
        let texture = this.textures.get(image);
        if (texture === undefined) {
            texture = Texture.from(image as HTMLCanvasElement);
            this.textures.set(image, texture);
        }
        const whole = [0, 0, texture.width, texture.height];
        const [sx = 0, sy = 0, sw = 0, sh = 0, dx = 0, dy = 0, dw = 0, dh = 0] =
            args.length === 2
                ? [...whole, args[0]!, args[1]!, texture.width, texture.height]
                : args.length === 4
                  ? [...whole, ...args]
                  : args;
        if (sx !== 0 || sy !== 0 || sw !== texture.width || sh !== texture.height) {
            texture = new Texture({ source: texture.source, frame: new Rectangle(sx, sy, sw, sh) });
        }
        const m = this.state.m;
        const g = this.draw();
        g.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
        g.setFillStyle({ alpha: this.state.globalAlpha });
        g.texture(texture, 0xffffff, dx, dy, dw, dh);
        g.resetTransform();
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
        let label = this.textPool[this.textsUsed];
        if (label === undefined) {
            label = this.makeText();
            this.textPool.push(label);
        }
        this.textsUsed++;
        label.text = text;
        label.style.fontFamily = fontFamily(this.state.font);
        label.tint = rgb;
        label.alpha = alpha * this.state.globalAlpha;
        label.anchor.set(anchorX(this.state.textAlign), anchorY(this.state.textBaseline));
        const m = this.state.m;
        const size = fontSize(this.state.font) / GLYPH_PX;
        const sx = Math.hypot(m.a, m.b);
        const sy = (m.a * m.d - m.b * m.c) / (sx || 1);
        label.position.set(m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f);
        label.rotation = Math.atan2(m.b, m.a);
        label.scale.set(sx * size, sy * size);
        this.target().addChild(label);
        this.graphics = null;
    }

    /** Hand the frame over: everything drawn since `begin` is in `root`. */
    end(): void {
        this.graphics = null;
    }

    // Internals.

    private apply(x: number, y: number): [number, number] {
        const m = this.state.m;
        return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
    }

    /** How much the transform stretches a length, on average. */
    private scaleOf(): number {
        const m = this.state.m;
        return Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
    }

    private target(): Container {
        return this.targets[this.targets.length - 1]!;
    }

    private nextMask(): { box: Container; mask: Graphics } {
        let masked = this.maskPool[this.masksUsed];
        if (masked === undefined) {
            masked = { box: new Container(), mask: new Graphics() };
            this.maskPool.push(masked);
        }
        this.masksUsed++;
        return masked;
    }

    /** The Graphics to draw into now, a fresh one after text, a mask, or a change of blending. */
    private draw(): Graphics {
        if (this.graphics !== null) return this.graphics;
        let g = this.graphicsPool[this.graphicsUsed];
        if (g === undefined) {
            g = new Graphics();
            this.graphicsPool.push(g);
        }
        this.graphicsUsed++;
        g.blendMode = this.state.globalCompositeOperation === "lighter" ? "add" : "normal";
        this.target().addChild(g);
        this.graphics = g;
        return g;
    }

    private fillPath(path: SubPath[], style: string | Gradient): void {
        if (style instanceof Gradient) return style.radial ? this.fillRadial(style) : this.fillLinear(path, style);
        const [rgb, alpha] = parseColour(style);
        const a = alpha * this.state.globalAlpha;
        if (a <= 0) return;
        for (const sub of path) {
            if (sub.points.length < 6) continue;
            for (const piece of clipPolygon(sub.points, this.state.clips)) {
                if (piece.length >= 6) this.draw().poly(piece, true).fill({ color: rgb, alpha: a });
            }
        }
    }

    private fillLinear(path: SubPath[], gradient: Gradient): void {
        const [x0, y0] = this.apply(gradient.x0, gradient.y0);
        const [x1, y1] = this.apply(gradient.x1, gradient.y1);
        const dx = x1 - x0;
        const dy = y1 - y0;
        const length2 = dx * dx + dy * dy;
        if (length2 === 0) return;
        for (const sub of path) {
            if (sub.points.length < 6) continue;
            for (const piece of clipPolygon(sub.points, this.state.clips)) {
                for (let k = -1; k <= GRADIENT_BANDS; k++) {
                    // Bands of t along the gradient, the first and last running on past its ends.
                    const from = k < 0 ? -Infinity : k / GRADIENT_BANDS;
                    const to = k >= GRADIENT_BANDS ? Infinity : (k + 1) / GRADIENT_BANDS;
                    let band: number[] | null = piece;
                    if (Number.isFinite(from)) band = clipHalfPlane(band, dx, dy, from * length2 + dx * x0 + dy * y0, true);
                    if (band !== null && Number.isFinite(to)) band = clipHalfPlane(band, dx, dy, to * length2 + dx * x0 + dy * y0, false);
                    if (band === null || band.length < 6) continue;
                    const [rgb, alpha] = gradient.at(Math.max(0, Math.min(1, (Math.max(from, 0) + Math.min(to, 1)) / 2)));
                    const a = alpha * this.state.globalAlpha;
                    if (a > 0) this.draw().poly(band, true).fill({ color: rgb, alpha: a });
                }
            }
        }
    }

    /** A radial gradient's disc, in rings: what it covers rather than the path, which canvas2d.ts makes the same. */
    private fillRadial(gradient: Gradient): void {
        const ring = (r: number): number[] => {
            const kept = this.path;
            this.path = [];
            this.arc(gradient.x1, gradient.y1, r, 0, 2 * Math.PI);
            const points = this.path[0]?.points ?? [];
            this.path = kept;
            return points;
        };
        for (let k = 0; k < GRADIENT_BANDS; k++) {
            const [rgb, alpha] = gradient.at((k + 0.5) / GRADIENT_BANDS);
            const a = alpha * this.state.globalAlpha;
            if (a <= 0) continue;
            const g = this.draw();
            g.poly(ring(((k + 1) / GRADIENT_BANDS) * gradient.r1), true).fill({ color: rgb, alpha: a });
            if (k > 0) g.poly(ring((k / GRADIENT_BANDS) * gradient.r1), true).cut();
        }
    }

    private strokePath(path: SubPath[]): void {
        const style = this.state.strokeStyle;
        if (typeof style !== "string") return;
        const [rgb, alpha] = parseColour(style);
        let width = this.state.lineWidth * this.scaleOf();
        let a = alpha * this.state.globalAlpha;
        // Thinner than a pixel, as a canvas shows it: a pixel wide and fainter.
        if (width < 1) {
            a *= width;
            width = 1;
        }
        if (a <= 0) return;
        const dash = this.state.dash.map((d) => d * this.scaleOf());
        const cap = this.state.lineCap;
        for (const sub of path) {
            if (sub.points.length < 4) continue;
            const line = sub.closed ? [...sub.points, sub.points[0]!, sub.points[1]!] : sub.points;
            const pieces = dash.length > 0 && dash.some((d) => d > 0) ? dashed(line, dash) : [line];
            for (const piece of pieces) {
                for (const kept of clipPolyline(piece, this.state.clips)) {
                    if (kept.length < 4) continue;
                    const whole = sub.closed && pieces.length === 1 && kept === piece;
                    const g = this.draw();
                    g.poly(whole ? kept.slice(0, -2) : kept, whole).stroke({ width, color: rgb, alpha: a, cap, join: "miter" });
                }
            }
        }
    }
}

// Geometry, exported for its tests.

/** The signed sweep of a canvas arc from `from` to `to`. */
export function arcSweep(from: number, to: number, anticlockwise: boolean): number {
    const turn = 2 * Math.PI;
    if (!anticlockwise) {
        if (to - from >= turn) return turn;
        const sweep = (((to - from) % turn) + turn) % turn;
        return sweep;
    }
    if (from - to >= turn) return -turn;
    const sweep = (((from - to) % turn) + turn) % turn;
    return -sweep;
}

/** `points` as an axis-aligned box on screen, if it is one. */
export function screenRect(points: number[]): Rectangle | null {
    if (points.length !== 8 && points.length !== 10) return null;
    const xs = new Set<number>();
    const ys = new Set<number>();
    for (let k = 0; k < 8; k += 2) {
        xs.add(Math.round(points[k]! * 1e6) / 1e6);
        ys.add(Math.round(points[k + 1]! * 1e6) / 1e6);
    }
    if (xs.size !== 2 || ys.size !== 2) return null;
    const [xa, xb] = [...xs];
    const [ya, yb] = [...ys];
    return new Rectangle(Math.min(xa!, xb!), Math.min(ya!, yb!), Math.abs(xb! - xa!), Math.abs(yb! - ya!));
}

/** A convex polygon's corners, wound anticlockwise on screen (y down), so its inside is on the left of each edge. */
export function convexHullOrder(points: number[]): number[] {
    let area = 0;
    for (let k = 0; k < points.length; k += 2) {
        const j = (k + 2) % points.length;
        area += points[k]! * points[j + 1]! - points[j]! * points[k + 1]!;
    }
    if (area >= 0) return points;
    const out: number[] = [];
    for (let k = points.length - 2; k >= 0; k -= 2) out.push(points[k]!, points[k + 1]!);
    return out;
}

/**
 * The part of polygon `points` on one side of the line `nx·x + ny·y = c`:
 * where it is at least `c` if `above`, at most if not.
 */
export function clipHalfPlane(points: number[], nx: number, ny: number, c: number, above: boolean): number[] | null {
    const out: number[] = [];
    const n = points.length / 2;
    const side = (k: number): number => (nx * points[2 * k]! + ny * points[2 * k + 1]! - c) * (above ? 1 : -1);
    for (let k = 0; k < n; k++) {
        const j = (k + 1) % n;
        const sk = side(k);
        const sj = side(j);
        if (sk >= 0) out.push(points[2 * k]!, points[2 * k + 1]!);
        if (sk >= 0 !== sj >= 0) {
            const t = sk / (sk - sj);
            out.push(
                points[2 * k]! + (points[2 * j]! - points[2 * k]!) * t,
                points[2 * k + 1]! + (points[2 * j + 1]! - points[2 * k + 1]!) * t,
            );
        }
    }
    return out.length >= 6 ? out : null;
}

/** Polygon `points` cut to convex polygon `clip`, wound as `convexHullOrder` leaves it. */
export function clipToConvex(points: number[], clip: number[]): number[] | null {
    let out: number[] | null = points;
    for (let k = 0; k < clip.length && out !== null; k += 2) {
        const j = (k + 2) % clip.length;
        const ex = clip[j]! - clip[k]!;
        const ey = clip[j + 1]! - clip[k + 1]!;
        // Inside is to the left of each edge: where the cross product is positive.
        out = clipHalfPlane(out, -ey, ex, -ey * clip[k]! + ex * clip[k + 1]!, true);
    }
    return out;
}

/** A filled polygon's pieces within every clip. The outside of a shape is not cut from a fill. */
function clipPolygon(points: number[], clips: readonly Clip[]): number[][] {
    let pieces = [points];
    for (const clip of clips) {
        if (!clip.inside) continue;
        const next: number[][] = [];
        for (const piece of pieces) {
            for (const poly of clip.polys) {
                const cut = clipToConvex(piece, poly);
                if (cut !== null) next.push(cut);
            }
        }
        pieces = next;
    }
    return pieces;
}

/** The parameters along segment p→q where it is inside convex `clip`, or null if it never is. */
function segmentInside(px: number, py: number, qx: number, qy: number, clip: number[]): [number, number] | null {
    let enter = 0;
    let leave = 1;
    const dx = qx - px;
    const dy = qy - py;
    for (let k = 0; k < clip.length; k += 2) {
        const j = (k + 2) % clip.length;
        const nx = -(clip[j + 1]! - clip[k + 1]!);
        const ny = clip[j]! - clip[k]!;
        // Inside where n·(x - corner) >= 0.
        const start = nx * (px - clip[k]!) + ny * (py - clip[k + 1]!);
        const rate = nx * dx + ny * dy;
        if (rate === 0) {
            if (start < 0) return null;
            continue;
        }
        const t = -start / rate;
        if (rate > 0) enter = Math.max(enter, t);
        else leave = Math.min(leave, t);
        if (enter > leave) return null;
    }
    return [enter, leave];
}

/** The parts of a polyline within every clip, or outside it for an outside one. */
export function clipPolyline(points: number[], clips: readonly Clip[]): number[][] {
    let pieces = [points];
    for (const clip of clips) {
        const next: number[][] = [];
        for (const piece of pieces) {
            for (const poly of clip.inside ? clip.polys : [clip.polys[0]!]) {
                let run: number[] = [];
                const flush = (): void => {
                    if (run.length >= 4) next.push(run);
                    run = [];
                };
                for (let k = 0; k + 3 < piece.length; k += 2) {
                    const [px, py, qx, qy] = [piece[k]!, piece[k + 1]!, piece[k + 2]!, piece[k + 3]!];
                    const at = (t: number): [number, number] => [px + (qx - px) * t, py + (qy - py) * t];
                    const inside = segmentInside(px, py, qx, qy, poly);
                    const kept: [number, number][] = [];
                    if (clip.inside) {
                        if (inside !== null && inside[1] > inside[0]) kept.push(inside);
                    } else if (inside === null || inside[1] <= inside[0]) kept.push([0, 1]);
                    else {
                        if (inside[0] > 0) kept.push([0, inside[0]]);
                        if (inside[1] < 1) kept.push([inside[1], 1]);
                    }
                    for (const [from, to] of kept) {
                        // A piece that carries on from the last segment's end joins its run.
                        if (from > 0 || run.length === 0) {
                            flush();
                            run.push(...at(from));
                        }
                        run.push(...at(to));
                        if (to < 1) flush();
                    }
                    if (kept.length === 0) flush();
                }
                flush();
            }
        }
        pieces = next;
    }
    return pieces;
}

/** A polyline cut into the dashes of `pattern`, in the same units. */
export function dashed(points: number[], pattern: readonly number[]): number[][] {
    const out: number[][] = [];
    let index = 0;
    let left = pattern[0]!;
    let on = true;
    let run: number[] = [points[0]!, points[1]!];
    for (let k = 0; k + 3 < points.length; k += 2) {
        let [px, py] = [points[k]!, points[k + 1]!];
        const [qx, qy] = [points[k + 2]!, points[k + 3]!];
        let length = Math.hypot(qx - px, qy - py);
        while (length > left) {
            const t = left / length;
            px += (qx - px) * t;
            py += (qy - py) * t;
            length -= left;
            if (on) {
                run.push(px, py);
                out.push(run);
            }
            run = [px, py];
            on = !on;
            index = (index + 1) % pattern.length;
            left = pattern[index]!;
        }
        left -= length;
        if (on) run.push(qx, qy);
    }
    if (on && run.length >= 4) out.push(run);
    return out;
}

const colours = new Map<string, [number, number]>();

/** A CSS colour as an RGB number and an alpha: `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()` or `rgba()`. */
export function parseColour(colour: string): [number, number] {
    let parsed = colours.get(colour);
    if (parsed !== undefined) return parsed;
    const text = colour.trim();
    if (text.startsWith("#")) {
        let hex = text.slice(1);
        if (hex.length === 3 || hex.length === 4) hex = [...hex].map((h) => h + h).join("");
        const rgb = Number.parseInt(hex.slice(0, 6), 16);
        const alpha = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1;
        parsed = [Number.isNaN(rgb) ? 0 : rgb, alpha];
    } else {
        const parts =
            /rgba?\(([^)]*)\)/
                .exec(text)?.[1]
                ?.split(/[\s,/]+/)
                .filter((p) => p.length > 0) ?? [];
        const channel = (k: number): number => Math.max(0, Math.min(255, Math.round(Number(parts[k] ?? 0))));
        const alpha = parts.length > 3 ? Number(parts[3]) : 1;
        parsed = [(channel(0) << 16) | (channel(1) << 8) | channel(2), Number.isNaN(alpha) ? 1 : alpha];
    }
    colours.set(colour, parsed);
    return parsed;
}

function mixRgb(p: number, q: number, u: number): number {
    const mix = (shift: number): number => Math.round(((p >> shift) & 255) * (1 - u) + ((q >> shift) & 255) * u);
    return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

function fontSize(font: string): number {
    return Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 10);
}

function fontFamily(font: string): string {
    return /px\s+(.+)$/.exec(font)?.[1] ?? "sans-serif";
}

function anchorX(align: string): number {
    return align === "center" ? 0.5 : align === "right" || align === "end" ? 1 : 0;
}

function anchorY(baseline: string): number {
    return baseline === "middle"
        ? 0.5
        : baseline === "bottom" || baseline === "ideographic"
          ? 1
          : baseline === "top" || baseline === "hanging"
            ? 0
            : 0.8;
}
