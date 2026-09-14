import { math, type ModuleSpec, type ShipDesign } from '../sim/index.js';
import type { Camera } from '../render/camera.js';
import { thrustEnvelope } from './stats.js';

const { cos, sin, max, TAU } = math;

/**
 * What the editor draws that a battle does not: the selection, the centre of
 * mass, and the shape of the manoeuvring envelope.
 *
 * Everything here goes *on top of* `render/canvas2d.ts` rather than replacing
 * any of it. The ship, its turrets and their firing arcs are drawn by the same
 * code the battle uses, so what the editor shows is what the player will see
 * flying — and the only things added are the ones that exist because somebody
 * is editing.
 */

const SELECTION = '#e9c05f';
const SELECTION_LINKED = '#e9c05fcc';
const CENTRE_OF_MASS = '#7fd6a0';
const ENVELOPE = '#5b8dd6';
const ENVELOPE_FILL = 'rgba(91, 141, 214, 0.18)';
const ENVELOPE_LABEL = '#7f93aa';

/** How many directions the envelope is sampled in. Smooth at a glance, cheap to take. */
const ENVELOPE_SAMPLES = 96;
/** Radius of the envelope rosette on screen, pixels. */
const ENVELOPE_RADIUS_PX = 54;
const ENVELOPE_MARGIN_PX = 16;

export interface OverlayView {
  design: ShipDesign | null;
  modules: readonly ModuleSpec[];
  /** Indices of the drawn modules the selection accounts for; the first is the one grabbed. */
  selected: readonly number[];
}

/**
 * Draw the editor's own marks. Call it straight after `draw`, which leaves the
 * world-to-screen transform in place.
 */
export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  view: OverlayView,
  camera: Camera,
  widthPx: number,
  heightPx: number,
): void {
  drawSelection(ctx, view, camera);
  if (view.design !== null) drawCentreOfMass(ctx, view.design, camera);

  // The rosette is a screen-space widget, so the world transform has to go
  // before it is drawn — and with it the y flip, which would otherwise draw
  // every label upside down.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (view.design !== null) drawEnvelope(ctx, view.design, widthPx, heightPx);
}

/**
 * Outline every copy the selection draws, the grabbed one brightest.
 *
 * Showing the others is the whole point rather than a courtesy: a thruster
 * placed eight times moves eight times when it is dragged once, and an editor
 * that let that come as a surprise would be worse than one with no assemblies
 * at all.
 */
function drawSelection(ctx: CanvasRenderingContext2D, view: OverlayView, camera: Camera): void {
  const lineWidth = max(1.5 / camera.scale, 0.08);
  for (let i = 0; i < view.selected.length; i++) {
    const spec = view.modules[view.selected[i]!];
    if (spec === undefined) continue;
    ctx.save();
    ctx.translate(spec.x, spec.y);
    ctx.rotate(spec.angle ?? 0);
    ctx.strokeStyle = i === 0 ? SELECTION : SELECTION_LINKED;
    ctx.lineWidth = lineWidth;
    if (i > 0) ctx.setLineDash([lineWidth * 4, lineWidth * 3]);
    ctx.strokeRect(-spec.length / 2, -spec.width / 2, spec.length, spec.width);
    ctx.setLineDash([]);
    ctx.restore();
  }
}

/**
 * Where the ship balances, in the blueprint's own frame.
 *
 * Worth a mark of its own because it is the one derived quantity with a
 * *place*: thrust off the centre of mass turns the ship, so a layout's
 * handling is largely a statement about where this dot sits relative to the
 * engines, and nothing else on the canvas says where it is.
 */
function drawCentreOfMass(
  ctx: CanvasRenderingContext2D,
  design: ShipDesign,
  camera: Camera,
): void {
  const r = max(6 / camera.scale, design.radius * 0.02);
  ctx.strokeStyle = CENTRE_OF_MASS;
  ctx.lineWidth = max(1.5 / camera.scale, 0.05);
  ctx.beginPath();
  ctx.arc(design.centreOfMassX, design.centreOfMassY, r, 0, TAU);
  ctx.moveTo(design.centreOfMassX - r * 1.6, design.centreOfMassY);
  ctx.lineTo(design.centreOfMassX + r * 1.6, design.centreOfMassY);
  ctx.moveTo(design.centreOfMassX, design.centreOfMassY - r * 1.6);
  ctx.lineTo(design.centreOfMassX, design.centreOfMassY + r * 1.6);
  ctx.stroke();
}

/**
 * The acceleration available in every direction, as a closed curve.
 *
 * Four numbers on a panel say a ship accelerates hard forwards and poorly
 * sideways; only the curve shows which diagonal it is worst in, and whether a
 * layout is merely weak abeam or has a direction it cannot push at all — the
 * dent that says a thruster is missing. Drawn at a fixed size in the corner
 * rather than over the ship, because it is an acceleration and not a distance,
 * and overlaying it on metres would invite reading it as reach.
 *
 * Bow up, since that is how the curve is read against a ship one is looking at
 * nose-right: the widget's own +y is forward.
 */
function drawEnvelope(
  ctx: CanvasRenderingContext2D,
  design: ShipDesign,
  widthPx: number,
  heightPx: number,
): void {
  const samples = thrustEnvelope(design, ENVELOPE_SAMPLES);
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = max(peak, samples[i]!);
  if (!(peak > 0)) return;

  const cx = widthPx - ENVELOPE_RADIUS_PX - ENVELOPE_MARGIN_PX;
  const cy = heightPx - ENVELOPE_RADIUS_PX - ENVELOPE_MARGIN_PX;

  ctx.beginPath();
  for (let i = 0; i < samples.length; i++) {
    // The sample is taken about the ship's +x; the widget draws that up, and
    // screen y grows downward, so bow-forward becomes -y on the canvas.
    const angle = (TAU * i) / samples.length;
    const r = (samples[i]! / peak) * ENVELOPE_RADIUS_PX;
    const x = cx - sin(angle) * r;
    const y = cy - cos(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = ENVELOPE_FILL;
  ctx.fill();
  ctx.strokeStyle = ENVELOPE;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = ENVELOPE_LABEL;
  ctx.font = '11px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`${peak.toFixed(1)} m/s² max`, cx, cy + ENVELOPE_RADIUS_PX + 12);
  ctx.textAlign = 'left';
}
