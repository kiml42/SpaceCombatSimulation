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

export function drawChart(
  ctx: CanvasRenderingContext2D,
  series: readonly Series[],
  widthPx: number,
  heightPx: number,
  ratio: number,
): void {
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
    return;
  }

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
}
