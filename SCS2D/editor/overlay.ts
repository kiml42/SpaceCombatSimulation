import { math, type ModuleSpec, type ShipDesign } from '../sim/index.js';
import type { Camera } from '../render/camera.js';
import { headingCost, type Envelopes } from './stats.js';
import type { GroupOutline } from './document.js';

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
/**
 * A group is outlined in a different colour from a module, and once around
 * everything it holds rather than separately around each part.
 *
 * Both cues say the same thing, deliberately. The colour says *what kind of
 * thing* is selected, which is what decides what an edit will do — dragging a
 * group moves the group. The single box says *how many things* are selected,
 * which a selection of several modules and a selection of one group could
 * otherwise look identical about: five outlines either way, and a drag that
 * behaves quite differently.
 */
const GROUP_SELECTION = '#7fd4ff';
/** The group's other copies, which a drag of the selected one leaves where they are. */
const GROUP_LINKED = '#7fd4ffcc';
/** The group a selected module sits in: context rather than selection, so it is faint. */
const GROUP_CONTEXT = '#7fd4ff66';
/** How far the group's box stands off what it contains, metres. */
const GROUP_BOX_MARGIN = 0.6;
const CENTRE_OF_MASS = '#7fd6a0';
const ENVELOPE = '#5b8dd6';
const ENVELOPE_FILL = 'rgba(91, 141, 214, 0.22)';
/** The outer curve is a reference rather than a capability, so it is drawn as one. */
const ENVELOPE_FREE = 'rgba(91, 141, 214, 0.55)';
const ENVELOPE_LABEL = '#7f93aa';

/** Radius of the envelope rosette on screen, pixels. */
const ENVELOPE_RADIUS_PX = 54;
const ENVELOPE_MARGIN_PX = 16;
/** Room kept below the rosette for its two caption lines, pixels. */
const ENVELOPE_CAPTION_PX = 32;

export interface OverlayView {
  design: ShipDesign | null;
  modules: readonly ModuleSpec[];
  /**
   * Indices of the drawn modules picked individually; the first is the one
   * grabbed. Groups are not among them — they come through `groups`.
   */
  selected: readonly number[];
  /** One box per drawn copy of a selected group, and of the group a selected module is in. */
  groups: readonly GroupOutline[];
  /**
   * The manoeuvring envelopes, or null when there is no design to have any.
   *
   * Passed in rather than derived here, because the holding curve costs
   * thousands of allocations and depends only on the layout. Panning and
   * zooming redraw; they do not re-measure the ship.
   */
  envelope: Envelopes | null;
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
  if (view.envelope !== null) drawEnvelope(ctx, view.envelope, widthPx, heightPx);
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

  drawGroups(ctx, view, lineWidth);
}

/**
 * One box around each drawn copy of a selected group, about everything it
 * holds — and a faint one around the group a selected module sits in.
 *
 * Corners rather than centres, and every module's own corners after its own
 * rotation, so a group of turned parts is boxed by what it actually covers
 * rather than by a rectangle its contents stick out of.
 */
function drawGroups(ctx: CanvasRenderingContext2D, view: OverlayView, lineWidth: number): void {
  for (const group of view.groups) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const index of group.modules) {
      const spec = view.modules[index];
      if (spec === undefined) continue;
      const angle = spec.angle ?? 0;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const halfL = spec.length / 2;
      const halfW = spec.width / 2;
      for (const [ox, oy] of [
        [halfL, halfW],
        [halfL, -halfW],
        [-halfL, halfW],
        [-halfL, -halfW],
      ] as const) {
        const x = spec.x + ox * c - oy * s;
        const y = spec.y + ox * s + oy * c;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (!(maxX > minX) && !(maxY > minY)) continue;

    ctx.save();
    ctx.strokeStyle = group.context
      ? GROUP_CONTEXT
      : group.primary
        ? GROUP_SELECTION
        : GROUP_LINKED;
    ctx.lineWidth = lineWidth;
    // Dashed for everything that is not the copy being edited, so the one a
    // drag would move reads as solid the way a grabbed module does.
    if (!group.primary) ctx.setLineDash([lineWidth * 4, lineWidth * 3]);
    ctx.strokeRect(
      minX - GROUP_BOX_MARGIN,
      minY - GROUP_BOX_MARGIN,
      maxX - minX + GROUP_BOX_MARGIN * 2,
      maxY - minY + GROUP_BOX_MARGIN * 2,
    );
    ctx.setLineDash([]);
    ctx.restore();
  }
}

/**
 * The centre-of-mass mark: a ringed crosshair.
 *
 * Drawn by whatever needs it rather than by one caller, because the same glyph
 * has to appear on the hull and at the centre of the envelope. The envelope's
 * zero *is* the centre of mass — it is the point the accelerations act on —
 * and drawing the identification rather than asserting it in a caption is the
 * cheapest way to say so. Symmetric about both axes, so it reads the same
 * through the renderer's y flip as it does in screen space.
 */
function crosshair(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  lineWidth: number,
): void {
  ctx.strokeStyle = CENTRE_OF_MASS;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.moveTo(x - r * 1.6, y);
  ctx.lineTo(x + r * 1.6, y);
  ctx.moveTo(x, y - r * 1.6);
  ctx.lineTo(x, y + r * 1.6);
  ctx.stroke();
}

/**
 * Where the ship balances, in the blueprint's own frame.
 *
 * Worth a mark of its own because it is the one derived quantity with a
 * *place*: thrust off the centre of mass turns the ship, so a layout's
 * handling is largely a statement about where this mark sits relative to the
 * engines, and nothing else on the canvas says where it is.
 */
function drawCentreOfMass(
  ctx: CanvasRenderingContext2D,
  design: ShipDesign,
  camera: Camera,
): void {
  crosshair(
    ctx,
    design.centreOfMassX,
    design.centreOfMassY,
    max(6 / camera.scale, design.radius * 0.02),
    max(1.5 / camera.scale, 0.05),
  );
}

/**
 * The acceleration available in every direction, as two closed curves.
 *
 * Four numbers on a panel say a ship accelerates hard forwards and poorly
 * sideways; only the curve shows which diagonal it is worst in, and whether a
 * layout is merely weak abeam or has a direction it cannot push at all — the
 * dent that says a thruster is missing.
 *
 * **The filled curve is what the ship can use; the dashed one is what it could
 * have if it did not mind spinning.** The gap between them is what KSP shows
 * as a centre of thrust offset from the centre of mass, in the units that
 * matter here. It has to be drawn as a gap rather than as a second marker,
 * because the misalignment never becomes a spin: allocation is asked for zero
 * torque and trims the imbalance away, so what a badly balanced layout loses
 * is acceleration. Two curves make that a dent, and a dent is something the
 * eye reads at a glance; two markers to mentally subtract is not.
 *
 * Drawn at a fixed size in the corner rather than over the ship, because it is
 * an acceleration and not a distance, and overlaying it on metres would invite
 * reading it as reach.
 *
 * **In the ship's own orientation**: +x to the right and +y up, exactly as the
 * deck plan beside it is drawn. The curve is read by comparing it against the
 * ship, so any other convention makes it a puzzle — a layout that accelerates
 * hard fore and aft draws a curve long across the same axis its hull is long
 * on, and turning the widget by a right angle turns that agreement into an
 * apparent contradiction.
 *
 * Both curves are *thrust*. A propellant model would make the third curve
 * possible — how much delta-v a direction costs, on which a diagonal does
 * worse than either axis it splits, since thrust adds vectorially and
 * propellant adds scalar — and drawing it before that model exists would be
 * inventing an efficiency the simulation does not have.
 */
function drawEnvelope(
  ctx: CanvasRenderingContext2D,
  envelope: Envelopes,
  widthPx: number,
  heightPx: number,
): void {
  let peak = 0;
  let held = 0;
  for (let i = 0; i < envelope.samples; i++) {
    peak = max(peak, envelope.free[i]!);
    held = max(held, envelope.holding[i]!);
  }
  if (!(peak > 0)) return;

  const cx = widthPx - ENVELOPE_RADIUS_PX - ENVELOPE_MARGIN_PX;
  const cy = heightPx - ENVELOPE_RADIUS_PX - ENVELOPE_MARGIN_PX - ENVELOPE_CAPTION_PX;

  /** Trace one curve, scaled against the larger of the two so the gap is to scale. */
  const trace = (values: Float64Array): void => {
    ctx.beginPath();
    for (let i = 0; i < envelope.samples; i++) {
      // Samples run anticlockwise from the bow in the ship's frame. Screen y
      // grows downward where the world's grows up, so only y is negated —
      // which is the same flip `draw` applies to the deck plan.
      const angle = (TAU * i) / envelope.samples;
      const r = (values[i]! / peak) * ENVELOPE_RADIUS_PX;
      const x = cx + cos(angle) * r;
      const y = cy - sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  };

  // The unconstrained curve first and dashed, so the filled one sits inside it
  // and reads as the real figure rather than as a shortfall from it.
  trace(envelope.free);
  ctx.strokeStyle = ENVELOPE_FREE;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.stroke();
  ctx.setLineDash([]);

  trace(envelope.holding);
  ctx.fillStyle = ENVELOPE_FILL;
  ctx.fill();
  ctx.strokeStyle = ENVELOPE;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // The origin, marked as what it is: the ship's centre of mass, with every
  // radius an acceleration of it. Without it the curve has no zero, and a
  // lobed shape with no centre cannot be read as a magnitude at all.
  crosshair(ctx, cx, cy, 3.5, 1.5);

  // Right-aligned to the widget's own edge rather than centred under it, so a
  // caption naming both curves has somewhere to go.
  //
  // The second line is the *worst* gap between the curves and not the gap
  // between their peaks, which would be a different and much less useful
  // number: a ship's best direction is usually its best under both curves, so
  // comparing peaks reports a layout as balanced however badly it is trimmed
  // abeam. The fractal is the case — 10.0 against 10.1 at the bow, and 72% of
  // its beam thrust spent on not spinning.
  ctx.fillStyle = ENVELOPE_LABEL;
  ctx.font = '11px ui-monospace, monospace';
  ctx.textAlign = 'right';
  const right = widthPx - ENVELOPE_MARGIN_PX;
  ctx.fillText(`${held.toFixed(1)} m/s² holding heading`, right, cy + ENVELOPE_RADIUS_PX + 14);
  const cost = headingCost(envelope);
  if (cost >= 0.005) {
    ctx.fillText(`heading cost up to ${(cost * 100).toFixed(0)}%`, right, cy + ENVELOPE_RADIUS_PX + 28);
  }
  ctx.textAlign = 'left';
}
