import { math, moduleCentre, type ModuleSpec } from '../sim/index.js';
import { describeStep, snapStep, type Camera } from '../render/camera.js';
import { HANDLE_RADIUS_PX, ROTATE_ARM_PX } from './handles.js';

/** What the fleet editor draws over the fleet: selection, faults, the knob and which way is forward. */

const { cos, sin, TAU } = math;

// The ship editor's colours, so a selected ship reads as a selected module
// does and a group of ships as a group of modules.
const SELECTION = '#e9c05f';
const SELECTION_LINKED = '#e9c05fcc';
const GROUP_SELECTION = '#7fd4ff';
const GROUP_LINKED = '#7fd4ffcc';
const GROUP_CONTEXT = '#7fd4ff66';
const GROUP_BOX_MARGIN_PX = 7;
const FAULT_FILL = 'rgba(255, 107, 94, 0.32)';
const HANDLE_EDGE = '#1b1f27';
const FORWARD = '#7fd6a0';
const LABEL = '#7f93aa';
const LINE_PX = 1.5;
const FORWARD_PX = 40;
/** Below this on screen a hull outline is lost, so a ring is drawn round it too. */
const RING_PX = 10;

export interface FleetOverlayView {
  hulls: readonly (readonly ModuleSpec[])[];
  /** Each ship's centre and radius, null where it will not compile. */
  circles: readonly ({ x: number; y: number; radius: number } | null)[];
  faulty: readonly number[];
  /** Selected ships, one entry per drawn copy; the primary one is the copy an edit is framed by. */
  ships: readonly { ships: readonly number[]; primary: boolean }[];
  /**
   * Boxes round groups: the selected one (solid where it is the copy being
   * edited, dashed for its other copies) and, faintly, the one a selection
   * has stepped into.
   */
  boxes: readonly { ships: readonly number[]; angle: number; style: 'primary' | 'linked' | 'context' }[];
  /** The knob and the origin its arm runs from, or null when there is none to show. */
  knob: { x: number; y: number; fromX: number; fromY: number } | null;
}

/** Where the knob sits for an entry: ahead of it, just beyond its reach. */
export function knobFor(x: number, y: number, angle: number, reach: number, scale: number): { x: number; y: number } {
  const arm = reach + ROTATE_ARM_PX / scale;
  return { x: x + arm * cos(angle), y: y + arm * sin(angle) };
}

export function drawFleetOverlay(
  ctx: CanvasRenderingContext2D,
  view: FleetOverlayView,
  camera: Camera,
  heightPx: number,
): void {
  const px = 1 / camera.scale;

  for (const i of view.faulty) {
    for (const spec of view.hulls[i] ?? []) {
      if (!(spec.length > 0) || !(spec.width > 0)) continue;
      const mid = moduleCentre(spec);
      ctx.save();
      ctx.translate(mid.x, mid.y);
      ctx.rotate(spec.angle ?? 0);
      ctx.fillStyle = FAULT_FILL;
      ctx.fillRect(-spec.length / 2, -spec.width / 2, spec.length, spec.width);
      ctx.restore();
    }
    ring(ctx, view.circles[i], camera, FAULT_FILL);
  }

  const line = LINE_PX * px;
  ctx.lineWidth = line;
  for (const copy of view.ships) {
    ctx.strokeStyle = copy.primary ? SELECTION : SELECTION_LINKED;
    if (!copy.primary) ctx.setLineDash([line * 4, line * 3]);
    for (const i of copy.ships) {
      for (const spec of view.hulls[i] ?? []) {
        const mid = moduleCentre(spec);
        ctx.save();
        ctx.translate(mid.x, mid.y);
        ctx.rotate(spec.angle ?? 0);
        ctx.strokeRect(-spec.length / 2, -spec.width / 2, spec.length, spec.width);
        ctx.restore();
      }
      ring(ctx, view.circles[i], camera, null);
    }
    ctx.setLineDash([]);
  }

  for (const box of view.boxes) drawBox(ctx, view.hulls, box, line, GROUP_BOX_MARGIN_PX * px);

  if (view.knob !== null) {
    ctx.strokeStyle = SELECTION;
    ctx.lineWidth = line;
    ctx.beginPath();
    ctx.moveTo(view.knob.fromX, view.knob.fromY);
    ctx.lineTo(view.knob.x, view.knob.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(view.knob.x, view.knob.y, HANDLE_RADIUS_PX * px, 0, TAU);
    ctx.fillStyle = SELECTION;
    ctx.fill();
    ctx.strokeStyle = HANDLE_EDGE;
    ctx.lineWidth = px;
    ctx.stroke();
  }

  // The fleet's own +x, which is the way it will face the enemy.
  const len = FORWARD_PX * px;
  ctx.strokeStyle = FORWARD;
  ctx.lineWidth = LINE_PX * px;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(len, 0);
  ctx.moveTo(len * 0.75, len * 0.15);
  ctx.lineTo(len, 0);
  ctx.lineTo(len * 0.75, -len * 0.15);
  ctx.stroke();

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = LABEL;
  ctx.font = '11px ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`snaps to ${describeStep(snapStep(camera.scale))} · arrow is forward`, 16, heightPx - 16);
}

/** A ring round a ship too small on screen to see outlined, filled or stroked in the current style. */
function ring(
  ctx: CanvasRenderingContext2D,
  circle: { x: number; y: number; radius: number } | null | undefined,
  camera: Camera,
  fill: string | null,
): void {
  if (circle == null || circle.radius * camera.scale >= RING_PX) return;
  ctx.beginPath();
  ctx.arc(circle.x, circle.y, RING_PX / camera.scale, 0, TAU);
  if (fill === null) ctx.stroke();
  else {
    ctx.fillStyle = fill;
    ctx.fill();
  }
}

/**
 * A rectangle round everything a copy of a group holds, square to that copy's
 * heading, so a turned line of ships gets a box its own shape rather than one
 * as wide as its diagonal.
 */
function drawBox(
  ctx: CanvasRenderingContext2D,
  hulls: readonly (readonly ModuleSpec[])[],
  box: FleetOverlayView['boxes'][number],
  line: number,
  margin: number,
): void {
  const c = cos(box.angle);
  const s = sin(box.angle);
  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;
  for (const i of box.ships) {
    for (const spec of hulls[i] ?? []) {
      const angle = spec.angle ?? 0;
      const mc = cos(angle);
      const ms = sin(angle);
      const mid = moduleCentre(spec);
      for (const [ol, ow] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ] as const) {
        const x = mid.x + (ol * spec.length * mc - ow * spec.width * ms) / 2;
        const y = mid.y + (ol * spec.length * ms + ow * spec.width * mc) / 2;
        // Into the box's own frame.
        const u = x * c + y * s;
        const v = -x * s + y * c;
        minU = Math.min(minU, u);
        maxU = Math.max(maxU, u);
        minV = Math.min(minV, v);
        maxV = Math.max(maxV, v);
      }
    }
  }
  if (!(maxU >= minU)) return;
  ctx.save();
  ctx.rotate(box.angle);
  ctx.strokeStyle = box.style === 'primary' ? GROUP_SELECTION : box.style === 'linked' ? GROUP_LINKED : GROUP_CONTEXT;
  ctx.lineWidth = line;
  if (box.style !== 'primary') ctx.setLineDash([line * 4, line * 3]);
  ctx.strokeRect(minU - margin, minV - margin, maxU - minU + margin * 2, maxV - minV + margin * 2);
  ctx.restore();
}
