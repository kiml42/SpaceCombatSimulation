import { math, moduleCentre, type ModuleSpec } from '../sim/index.js';
import { describeStep, snapStep, type Camera } from '../render/camera.js';
import { HANDLE_RADIUS_PX, ROTATE_ARM_PX } from './handles.js';

/** What the fleet editor draws over the fleet: selection, faults, the knob and which way is forward. */

const { cos, sin, TAU } = math;

const SELECTION = '#e9c05f';
const SELECTION_OTHERS = '#e9c05f88';
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
  /**
   * Per selected entry, first picked first: the copy that was clicked — its
   * origin, facing, reach and ships — and the ships of every copy.
   */
  selected: readonly {
    x: number;
    y: number;
    angle: number;
    reach: number;
    ships: readonly number[];
    copy: readonly number[];
  }[];
  /** Where the turning knob is, or null when there is none to show. */
  knob: { x: number; y: number } | null;
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

  view.selected.forEach((entry, n) => {
    ctx.lineWidth = LINE_PX * px;
    for (const i of entry.ships) {
      // The copy clicked is the one an edit is framed by; the rest move with it.
      ctx.strokeStyle = n === 0 && entry.copy.includes(i) ? SELECTION : SELECTION_OTHERS;
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
    // A group is one thing, so it gets one ring round the lot.
    if (entry.copy.length > 1) {
      ctx.strokeStyle = n === 0 ? SELECTION : SELECTION_OTHERS;
      ctx.setLineDash([6 * px, 4 * px]);
      ctx.beginPath();
      ctx.arc(entry.x, entry.y, entry.reach, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  });

  const first = view.selected[0];
  if (view.knob !== null && first !== undefined) {
    ctx.strokeStyle = SELECTION;
    ctx.lineWidth = LINE_PX * px;
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
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
