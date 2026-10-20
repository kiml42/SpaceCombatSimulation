import { capture, Snapshot, type ImpactLog } from '../sim/index.js';
import { Flashes } from '../render/flashes.js';
import {
  ARCS_KEY,
  closeUps,
  draw,
  drawCloseUps,
  drawFleetStrips,
  fleetStrips,
  nextArcs,
  overlayAt,
  STRIPS_KEY,
  stripsWidth,
  TEAM_SHOTS_KEY,
  type Arcs,
} from '../render/canvas2d.js';
import type { Strips } from '../render/fleetStrip.js';
import type { Inset } from '../render/inset.js';
import {
  frame,
  jumpAnchors,
  moveAcrossJump,
  moveWithVisibleShips,
  selectionBounds,
  shipAt,
  type Camera,
  type JumpAnchor,
} from '../render/camera.js';
import type { Battle } from '../scenarios/types.js';
import { Rewind } from '../scenarios/rewind.js';
import { viewGestures } from './viewGestures.js';
import { keepSpeed, loadView, saveView, type ViewSettings } from './viewSettings.js';

/**
 * A battle drawn on a canvas and run on the wall clock: the camera, the
 * flashes, picking a ship out, and the keys that go with them. The page
 * decides what battle it is and what else to show.
 *
 * **The wall clock lives here and only here.** The simulation takes a fixed
 * step and has no idea what time it is (DESIGN.md non-negotiable 2); this
 * accumulates real elapsed time and decides how many fixed steps to run for it.
 * That is what lets the same battle run at half speed, at eight times speed, or
 * flat out in a headless test, and come out identical.
 */

/**
 * Cap on steps per frame. A tab left in the background must not try to catch
 * up; twice what the fastest speed asks at 60 Hz, so a slow frame at 16x is
 * made up rather than dropped.
 */
const MAX_STEPS_PER_FRAME = 32;

export interface BattleView {
  /** Show this battle from its start, running or held, and if `rewindable`, able to be wound back. */
  show(battle: Battle, running: boolean, rewindable?: boolean): void;
  /** The battle on show, which winding back replaces. */
  readonly battle: Battle | null;
  /** Steps taken, and the furthest reached. */
  readonly at: number;
  readonly reached: number;
  /** Go to the checkpoint nearest a step, or the furthest reached, if the battle can be wound back. */
  seek(step: number): void;
  setRunning(running: boolean): void;
  readonly running: boolean;
  /** Hold the battle and take one step. */
  step(): void;
  setSpeed(speed: number): void;
  /** Frame everything again, and keep it framed. */
  fit(): void;
  /**
   * Remember this page's arcs, shot colours and speed between visits, taking
   * the speed from and to this list.
   */
  keep(page: string, speed: HTMLSelectElement): void;
  readonly camera: Readonly<Camera>;
}

/**
 * `stepped` is told after every step, for whatever is judging the battle;
 * `drawn` after every frame, with what was drawn; `runningChanged` whenever
 * it starts or stops; `rewound` when it is wound back, with the copy of the
 * battle it goes on with, whose steps up to there `stepped` is not told of.
 */
export function battleView(
  canvas: HTMLCanvasElement,
  stepped: (battle: Battle) => void,
  drawn: (view: Snapshot) => void,
  runningChanged: (running: boolean) => void,
  rewound: (battle: Battle) => void = () => {},
): BattleView {
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('no 2d context');

  let battle: Battle | null = null;
  let rewind: Rewind | null = null;
  /** A step to go to, taken at the next frame, so dragging a scrub bar re-simulates once a frame at most. */
  let seeking = -1;
  const snapshot = new Snapshot();
  const flashes = new Flashes();
  const camera: Camera = { x: 0, y: 0, scale: 0.1 };
  let selected = -1;
  let autoFrame = true;
  let framed = false;
  let running = false;
  let speed = 1;
  let accumulator = 0;
  let last = 0;
  let lastSimTime = 0;
  let arcs: Arcs = 'none';
  let teamShots = false;
  let strips = true;
  /** What was last drawn over the view, for a tap to find. */
  let shownStrips: Strips | null = null;
  let shownInsets: Inset[] = [];
  /** Where the view's settings are kept, once a page has asked for them to be. */
  let kept: { page: string; settings: ViewSettings } | null = null;
  const remember = (): void => {
    if (kept === null) return;
    kept.settings.arcs = arcs;
    kept.settings.teamShots = teamShots;
    kept.settings.strips = strips;
    saveView(kept.page, kept.settings);
  };

  const resize = (): void => {
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = Math.round(rect.width * ratio);
    const height = Math.round(rect.height * ratio);
    // Setting either clears the canvas, even to the size it already is.
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
  };
  new ResizeObserver(resize).observe(canvas);
  resize();

  const setRunning = (next: boolean): void => {
    running = next;
    // Drop whatever time passed while paused, rather than running it off in one burst.
    last = 0;
    runningChanged(running);
  };
  const step = (): void => {
    if (battle === null) return;
    if (rewind === null) battle.step();
    else rewind.step();
    stepped(battle);
  };

  viewGestures(
    canvas,
    camera,
    () => {
      autoFrame = false;
    },
    (x, y, reach) => {
      // A tile or close-up first: it is drawn over whatever is under it.
      const shown = overlayAt(shownStrips, shownInsets, camera, canvas.width, canvas.height, x, y);
      selected = shown >= 0 ? shown : shipAt(snapshot, x, y, reach);
      if (selected >= 0) autoFrame = true;
    },
  );

  window.addEventListener('keydown', (event) => {
    // Typing in a field is not a command; a list or a slider still answers to Space.
    const focus = document.activeElement;
    if ((focus instanceof HTMLInputElement && focus.type !== 'range') || focus instanceof HTMLTextAreaElement) return;
    if (event.key === ' ') {
      event.preventDefault();
      setRunning(!running);
    } else if (event.key === '.') {
      setRunning(false);
      step();
    } else if (event.key === ',' && rewind !== null) {
      setRunning(false);
      seeking = Math.max(0, (seeking >= 0 ? seeking : rewind.at) - 1);
    } else if (event.key === 'Escape') {
      selected = -1;
    } else if (event.key === 'f' || event.key === 'F') {
      autoFrame = true;
    } else if (event.key.toLowerCase() === ARCS_KEY && !event.ctrlKey && !event.metaKey) {
      arcs = nextArcs(arcs);
      remember();
    } else if (event.key.toLowerCase() === TEAM_SHOTS_KEY && !event.ctrlKey && !event.metaKey) {
      teamShots = !teamShots;
      remember();
    } else if (event.key.toLowerCase() === STRIPS_KEY && !event.ctrlKey && !event.metaKey) {
      strips = !strips;
      remember();
    }
  });

  /** What a step hit, into the flashes, as `capture` hands it over. */
  const drain = (log: ImpactLog): void => {
    for (let i = 0; i < log.count; i++) {
      flashes.add(
        log.x[i]!,
        log.y[i]!,
        log.energy[i]!,
        log.kind[i]!,
        log.body[i]!,
        log.localX[i]!,
        log.localY[i]!,
        log.vx[i]!,
        log.vy[i]!,
        log.growth[i]!,
        log.dirX[i]!,
        log.dirY[i]!,
      );
    }
    log.clear();
  };

  const tick = (now: number): void => {
    window.requestAnimationFrame(tick);
    if (last === 0) last = now;
    const elapsed = Math.min((now - last) / 1000, 0.25);
    last = now;
    if (battle === null) return;

    // A seek is a jump, not time passing: the camera is carried across it, not run on over it.
    let jumped = false;
    let anchors: JumpAnchor[] | null = null;
    if (seeking >= 0 && rewind !== null) {
      // The ships being followed, from the picture last drawn, before it is replaced.
      if (!autoFrame) anchors = jumpAnchors(camera, snapshot, canvas.width, canvas.height);
      // Flashes are rebuilt across the steps re-simulated, aged as they would have been drawn.
      const restored = rewind.seek(seeking, () => flashes.clear(), (on) => {
        flashes.step(on.dt);
        drain(on.impacts.log);
      });
      battle = rewind.battle;
      if (restored) rewound(battle);
      jumped = true;
      seeking = -1;
      accumulator = 0;
    }

    if (running) {
      accumulator += elapsed * speed;
      let steps = 0;
      while (accumulator >= battle.dt && steps < MAX_STEPS_PER_FRAME) {
        step();
        accumulator -= battle.dt;
        steps++;
      }
      // Falling behind slows the battle down rather than queueing up a lurch.
      if (steps === MAX_STEPS_PER_FRAME) accumulator = 0;
    }

    const view = capture(snapshot, battle.world, battle.ships, battle.projectiles, battle.beams, battle.wells, battle.impacts.log);
    const simDt = !jumped && view.time > lastSimTime ? view.time - lastSimTime : 0;
    lastSimTime = view.time;

    const ratio = window.devicePixelRatio || 1;
    const tiles = strips ? fleetStrips(view, canvas.width, canvas.height, ratio) : null;
    // Framed between the strips, which cover the view's edges.
    const framedWidth = canvas.width - 2 * stripsWidth(tiles);
    moveWithVisibleShips(camera, view, simDt, canvas.width, canvas.height);
    if (anchors !== null) moveAcrossJump(camera, anchors, view);
    if (autoFrame) {
      if (!framed) {
        frame(camera, view, framedWidth, canvas.height, 1);
        framed = true;
      }
      // Framed exactly across a jump, rather than eased there in real time.
      frame(camera, selectionBounds(view, selected) ?? view, framedWidth, canvas.height, jumped ? 1 : undefined);
    }

    // Flashes fade on the battle's clock, so a paused battle holds them.
    flashes.step(simDt);
    for (let i = 0; i < view.impactCount; i++) {
      flashes.add(
        view.impactX[i]!,
        view.impactY[i]!,
        view.impactEnergy[i]!,
        view.impactKind[i]!,
        view.impactBody[i]!,
        view.impactLocalX[i]!,
        view.impactLocalY[i]!,
        view.impactVx[i]!,
        view.impactVy[i]!,
        view.impactGrowth[i]!,
        view.impactDirX[i]!,
        view.impactDirY[i]!,
      );
    }
    draw(ctx, view, camera, canvas.width, canvas.height, flashes, arcs, teamShots, selected);
    if (tiles !== null) drawFleetStrips(ctx, view, tiles, selected, ratio, flashes, arcs, teamShots);
    const insets = closeUps(view, camera, canvas.width, canvas.height, selected, ratio, tiles);
    drawCloseUps(ctx, view, insets, selected, ratio, flashes, arcs, teamShots);
    shownStrips = tiles;
    shownInsets = insets;
    drawn(view);
  };
  window.requestAnimationFrame(tick);

  return {
    show(next, run, rewindable = false) {
      battle = next;
      rewind = rewindable ? new Rewind(next, () => performance.now()) : null;
      seeking = -1;
      selected = -1;
      flashes.clear();
      framed = false;
      autoFrame = true;
      accumulator = 0;
      lastSimTime = 0;
      setRunning(run);
    },
    get battle() {
      return battle;
    },
    get at() {
      return rewind?.at ?? battle?.world.tick ?? 0;
    },
    get reached() {
      return rewind?.reached ?? battle?.world.tick ?? 0;
    },
    seek(target) {
      if (rewind !== null) seeking = rewind.snap(target);
    },
    setRunning,
    step() {
      setRunning(false);
      step();
    },
    get running() {
      return running;
    },
    setSpeed(next) {
      speed = next;
    },
    fit() {
      autoFrame = true;
    },
    keep(page, select) {
      const settings = loadView(page, { arcs, teamShots, strips, speed });
      kept = { page, settings };
      arcs = settings.arcs;
      teamShots = settings.teamShots;
      strips = settings.strips;
      speed = keepSpeed(select, page, settings);
    },
    camera,
  };
}
