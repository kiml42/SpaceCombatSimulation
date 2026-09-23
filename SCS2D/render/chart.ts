/**
 * A small multi-series line chart, for reading a run while it happens.
 *
 * Deliberately not a charting library. What is wanted is one picture answering
 * one question — is this getting better, and at which of the things it is
 * being scored on — and the whole of it is a polyline per series and a couple
 * of gridlines. Anything with axes worth configuring would be tooling ahead of
 * the game (DESIGN.md §9).
 */

export interface Series {
  readonly name: string;
  readonly colour: string;
  /** One value per step along the x axis; holes are allowed and skipped. */
  readonly values: readonly number[];
  /** Drawn as a broken line, for a series that is a comparison rather than a result. */
  readonly dashed?: boolean;
}

const BACKGROUND = '#0d1219';
const AXIS = '#243044';
const LABEL = '#7f93aa';
const PADDING = { left: 46, right: 8, top: 8, bottom: 18 };

/** A round number near `rough`, so gridlines land on values worth reading. */
function nice(rough: number): number {
  if (!(rough > 0)) return 1;
  let step = 1;
  while (step < rough) step *= 10;
  while (step > rough) step /= 10;
  for (const factor of [1, 2, 5, 10]) {
    if (step * factor >= rough) return step * factor;
  }
  return step * 10;
}

/**
 * Where the chart put its plot, so a pointer over it can be read back.
 *
 * Returned rather than recomputed by the caller, because a second copy of the
 * padding and the point spacing is a second copy that can disagree — and the
 * way it would disagree is a tooltip naming the generation next to the one
 * under the cursor, which looks like nothing at all until somebody trusts it.
 */
export interface ChartLayout {
  /** The plot rectangle, in CSS pixels from the canvas's top left. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Points along it. Zero when there is nothing to draw. */
  readonly count: number;
}

/** What to mark on the chart: what the pointer is over, and what is selected. */
export interface ChartMarks {
  readonly hover?: number | undefined;
  readonly picked?: number | undefined;
}

const EMPTY: ChartLayout = { x: 0, y: 0, width: 0, height: 0, count: 0 };

/** Where one point sits along the plot, in CSS pixels. */
export function xOf(layout: ChartLayout, index: number): number {
  if (layout.count <= 1) return layout.x + layout.width / 2;
  return layout.x + (index / (layout.count - 1)) * layout.width;
}

/**
 * Which point a pointer is nearest, or null when there is nothing under it.
 *
 * Nearest rather than "within a few pixels of", because a run of four hundred
 * generations puts its points closer together than a pointer can be aimed —
 * what somebody means by pointing at the chart is the generation *about*
 * there, and every position between two points belongs to one of them.
 *
 * `clamp` is for a drag rather than a hover: while seeking, a pointer beyond
 * either end of the plot means that end rather than nothing.
 */
export function indexAt(layout: ChartLayout, xCss: number, clamp = false): number | null {
  if (layout.count === 0) return null;
  if (layout.count === 1) return 0;
  const along = (xCss - layout.x) / layout.width;
  // Off the plot is nothing to point *at*, but something to drag *to*: a
  // pointer that has run past the end of the run while seeking means the end
  // of the run, not that the seek has stopped.
  if (!clamp && (along < -0.02 || along > 1.02)) return null;
  const index = Math.round(along * (layout.count - 1));
  return Math.max(0, Math.min(layout.count - 1, index));
}

export function drawChart(
  ctx: CanvasRenderingContext2D,
  series: readonly Series[],
  widthPx: number,
  heightPx: number,
  ratio: number,
  marks: ChartMarks = {},
): ChartLayout {
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const width = widthPx / ratio;
  const height = heightPx / ratio;
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, width, height);

  let count = 0;
  let low = Infinity;
  let high = -Infinity;
  for (const line of series) {
    count = Math.max(count, line.values.length);
    for (const value of line.values) {
      if (!Number.isFinite(value)) continue;
      low = Math.min(low, value);
      high = Math.max(high, value);
    }
  }
  const plot = {
    x: PADDING.left,
    y: PADDING.top,
    width: Math.max(1, width - PADDING.left - PADDING.right),
    height: Math.max(1, height - PADDING.top - PADDING.bottom),
  };

  ctx.font = '10px ui-monospace, monospace';
  ctx.fillStyle = LABEL;
  if (count === 0) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('nothing fought yet', width / 2, height / 2);
    return EMPTY;
  }
  const layout: ChartLayout = { ...plot, count };

  // Always include zero: these are scores, and how far above nothing a run has
  // got is the thing being looked at.
  low = Math.min(low, 0);
  high = Math.max(high, low + 1e-6);
  const step = nice((high - low) / 4);
  low = Math.floor(low / step) * step;
  high = Math.ceil(high / step) * step;

  const atX = (i: number): number =>
    plot.x + (count > 1 ? (i / (count - 1)) * plot.width : plot.width / 2);
  const atY = (value: number): number =>
    plot.y + plot.height - ((value - low) / (high - low)) * plot.height;

  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 1;
  for (let value = low; value <= high + step / 2; value += step) {
    const y = Math.round(atY(value)) + 0.5;
    ctx.strokeStyle = Math.abs(value) < step / 2 ? '#31415a' : AXIS;
    ctx.beginPath();
    ctx.moveTo(plot.x, y);
    ctx.lineTo(plot.x + plot.width, y);
    ctx.stroke();
    ctx.fillStyle = LABEL;
    ctx.fillText(value.toFixed(2), plot.x - 6, y);
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('generation 1', plot.x + 14, plot.y + plot.height + 4);
  if (count > 1) ctx.fillText(String(count), plot.x + plot.width - 6, plot.y + plot.height + 4);

  // Under the lines, so a rule never hides the value it is pointing at.
  for (const [at, colour] of [
    [marks.picked, '#31415a'],
    [marks.hover, '#5d6f85'],
  ] as const) {
    if (at === undefined || at < 0 || at >= count) continue;
    const x = Math.round(xOf(layout, at)) + 0.5;
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, plot.y);
    ctx.lineTo(x, plot.y + plot.height);
    ctx.stroke();
  }

  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  for (const line of series) {
    ctx.strokeStyle = line.colour;
    ctx.setLineDash(line.dashed === true ? [3, 3] : []);
    ctx.beginPath();
    let down = true;
    for (let i = 0; i < line.values.length; i++) {
      const value = line.values[i];
      if (value === undefined || !Number.isFinite(value)) {
        down = true;
        continue;
      }
      if (down) ctx.moveTo(atX(i), atY(value));
      else ctx.lineTo(atX(i), atY(value));
      down = false;
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // A dot per series on the point being pointed at, so the reading beside the
  // chart and the place on it are visibly the same generation.
  if (marks.hover !== undefined && marks.hover >= 0 && marks.hover < count) {
    for (const line of series) {
      const value = line.values[marks.hover];
      if (value === undefined || !Number.isFinite(value)) continue;
      ctx.fillStyle = line.colour;
      ctx.beginPath();
      ctx.arc(atX(marks.hover), atY(value), 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  return layout;
}
