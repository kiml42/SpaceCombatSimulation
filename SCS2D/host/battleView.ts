import { capture, NEUTRAL_TEAM, Snapshot, type ImpactLog, type ShipView } from '../sim/index.js';
import { NO_TARGET, OrderCancelCondition } from '../sim/ships.js';
import { Flashes } from '../render/flashes.js';
import {
  ARCS_KEY,
  closeUps,
  draw,
  drawCloseUps,
  drawFleetStrips,
  drawTargetRange,
  fleetStrips,
  nextArcs,
  overlayAt,
  overlayTileAt,
  STRIPS_KEY,
  stripsWidth,
  TEAM_SHOTS_KEY,
  viewPoint,
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
  type Bounds,
  type Camera,
  type JumpAnchor,
} from '../render/camera.js';
import { boxed, clicked, fighterGroup, sameDesign, shipViewAt, sideOf, stillThere, viewOf, wholeSide } from '../render/picking.js';
import type { Command, Logged, Order } from '../scenarios/commands.js';
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

/** The keys that arm a verb, and the one that stops. */
const VERB_KEYS: Readonly<Record<string, Verb>> = { k: 'attack', d: 'defend', r: 'ram', h: 'dock', g: 'scavenge', u: 'deliver' };
const STOP_KEY = 's';
/** Picks the whole side of the selection, or the first side. */
const SIDE_KEY = 'a';
const BOX_COLOUR = '#9fb4cc';

/** The ship drawn as a body, or null. */
function viewByBody(view: Snapshot, body: number): ShipView | null {
  for (let i = 0; i < view.shipCount; i++) if (view.ships[i]!.body === body) return view.ships[i]!;
  return null;
}

/** What framing a selection takes in: each picked ship, and what each is fighting and escorting. */
function pickedBounds(view: Snapshot, picked: readonly number[]): Bounds | null {
  let out: Bounds | null = null;
  for (const ship of picked) {
    const bounds = selectionBounds(view, viewOf(view, ship)?.body ?? -1);
    if (bounds === null) continue;
    out =
      out === null
        ? { ...bounds }
        : {
            minX: Math.min(out.minX, bounds.minX),
            minY: Math.min(out.minY, bounds.minY),
            maxX: Math.max(out.maxX, bounds.maxX),
            maxY: Math.max(out.maxY, bounds.maxY),
          };
  }
  return out;
}

export interface BattleView {
  /**
   * Show this battle from its start, running or held, and if `rewindable`,
   * able to be wound back and given `orders`, as a link carries them.
   */
  show(battle: Battle, running: boolean, rewindable?: boolean, orders?: readonly Logged[]): void;
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
  /**
   * Let the viewer give orders: right-click, a verb armed from the keys or
   * `arm`, Shift to add to the queue, Stop. Only on a battle that can be
   * wound back, since orders are logged where rewinds are kept.
   */
  allowOrders(): void;
  /** The ships picked out, by the simulation's index, the first leading. */
  readonly picked: readonly number[];
  /** The verb the next click on a ship gives, or null. */
  readonly armed: Verb | null;
  /** Arm a verb, or with null, disarm; an attack finishing on `cancelOn`. */
  arm(verb: Verb | null, cancelOn?: OrderCancelCondition): void;
  /** Give the armed verb, if its target is optional, with none: for doctrine to choose where. */
  nearest(append: boolean): void;
  /** Give a command to the battle now, logged. */
  issue(command: Command): void;
  /**
   * Have a click on a ship asked first whether it picks part of it, at the
   * world point it fell, through a close-up if it was in one; true takes the
   * click. Null to stop.
   */
  pickPart(handler: ((ship: ShipView, x: number, y: number) => boolean) | null): void;
  /** Outline these modules of this ship, by the simulation's index for it, or with null nothing. */
  mark(marked: { readonly ship: number; readonly modules: readonly number[] } | null): void;
  /** Every command given, for a link to carry. */
  readonly orders: readonly Logged[];
  /** Where a ship was last drawn, CSS pixels from the canvas's top left, or null. */
  screenOf(ship: number): { x: number; y: number } | null;
}

/** What a click on a ship can be armed to tell the selection. */
export type Verb = 'attack' | 'defend' | 'ram' | 'dock' | 'scavenge' | 'deliver';

/** Verbs given to a friend rather than against an enemy. */
const FRIENDLY: ReadonlySet<Verb> = new Set(['defend', 'dock', 'deliver']);
/** Verbs given to a ship of either side. */
const EITHER: ReadonlySet<Verb> = new Set(['scavenge']);
/** Verbs that can be given with no target, for doctrine to choose one. */
export const ANYWHERE: ReadonlySet<Verb> = new Set(['dock', 'scavenge', 'deliver']);

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
  /** The leading picked ship's body, as the renderer marks it, worked out each frame. */
  let selected = -1;
  let picked: number[] = [];
  let ordersAllowed = false;
  let partPicker: ((ship: ShipView, x: number, y: number) => boolean) | null = null;
  let markedModules: { readonly ship: number; readonly modules: readonly number[] } | null = null;
  let armed: Verb | null = null;
  let armedCancel = OrderCancelCondition.CompleteDisable;
  /** A box being dragged out, canvas pixels. */
  let box: { x0: number; y0: number; x1: number; y1: number } | null = null;
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
    (x, y, reach, shift, queue) => {
      // A tile or close-up first: it is drawn over whatever is under it. Not
      // with Shift, which adds the ship under the pointer in the battle itself.
      const shown = shift ? -1 : overlayAt(shownStrips, shownInsets, camera, canvas.width, canvas.height, x, y);
      const ship = shown >= 0 ? viewByBody(snapshot, shown) : shipViewAt(snapshot, x, y, reach);
      if (armed !== null && ship !== null) {
        order(armed, ship, queue, armedCancel);
        armed = null;
        return;
      }
      if (partPicker !== null && ship !== null && !shift) {
        const at = viewPoint(shownInsets, camera, canvas.width, canvas.height, x, y);
        if (partPicker(ship, at.x, at.y)) return;
      }
      // A tile standing for a side's fighters of one design picks them all.
      const tile = shift ? null : overlayTileAt(shownStrips, shownInsets, camera, canvas.width, canvas.height, x, y);
      picked = tile !== null && tile.count > 1 ? fighterGroup(snapshot, ship) : clicked(snapshot, picked, ship, shift);
      if (picked.length > 0) autoFrame = true;
    },
    {
      commanded(x, y, reach, queue) {
        const ship = shipViewAt(snapshot, x, y, reach);
        const side = sideOf(snapshot, picked);
        if (ship === null || side === null || ship.team === NEUTRAL_TEAM) return;
        // An armed verb first: on a Mac, Ctrl and a click arrive as a right-click.
        if (armed !== null) {
          order(armed, ship, queue, armedCancel);
          armed = null;
          return;
        }
        order(ship.team === side ? 'defend' : 'attack', ship, queue, OrderCancelCondition.CompleteDisable);
      },
      doubled(x, y, reach) {
        if (!ordersAllowed) return;
        picked = sameDesign(snapshot, shipViewAt(snapshot, x, y, reach));
      },
      boxed(x0, y0, x1, y1) {
        if (!ordersAllowed) return;
        picked = boxed(snapshot, picked, x0, y0, x1, y1);
        if (picked.length > 0) autoFrame = true;
      },
      boxing(next) {
        box = ordersAllowed ? next : null;
      },
    },
  );

  /** The picked ships told `verb` against `target`, if that makes sense for them. */
  const order = (verb: Verb, target: ShipView, append: boolean, cancelOn: OrderCancelCondition): void => {
    const side = sideOf(snapshot, picked);
    if (!ordersAllowed || side === null || target.ship === undefined || target.team === NEUTRAL_TEAM) return;
    // A friend is defended or docked with, and an enemy attacked or rammed.
    if (!EITHER.has(verb) && FRIENDLY.has(verb) !== (target.team === side)) return;
    const ships = picked.filter((i) => i !== target.ship);
    if (ships.length === 0) return;
    const given: Order = verb === 'attack' ? { kind: 'attack', target: target.ship, cancelOn } : { kind: verb, target: target.ship };
    issue({ kind: 'order', ships, order: given, append });
  };

  const nearest = (append: boolean): void => {
    if (armed === null || !ANYWHERE.has(armed) || sideOf(snapshot, picked) === null) return;
    issue({ kind: 'order', ships: picked, order: { kind: armed as 'dock' | 'scavenge' | 'deliver', target: NO_TARGET }, append });
    armed = null;
  };

  const issue = (command: Command): void => {
    if (!ordersAllowed || rewind === null) return;
    // Given where the battle is now, not where a pending seek would have taken it.
    seeking = -1;
    rewind.issue(command);
    battle = rewind.battle;
  };

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
    } else if (event.key === 'Enter' && armed !== null && ANYWHERE.has(armed)) {
      event.preventDefault();
      nearest(event.ctrlKey || event.metaKey || event.shiftKey);
    } else if (event.key === 'Escape') {
      if (armed !== null) armed = null;
      else picked = [];
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === ARCS_KEY) {
      // Not the browser's select-all.
      event.preventDefault();
      arcs = nextArcs(arcs);
      remember();
    } else if (ordersAllowed && !event.altKey && event.key.toLowerCase() === SIDE_KEY) {
      const side = sideOf(snapshot, picked) ?? 0;
      picked = wholeSide(snapshot, side);
    } else if (ordersAllowed && !event.ctrlKey && !event.metaKey && picked.length > 0 && VERB_KEYS[event.key.toLowerCase()] !== undefined) {
      armed = VERB_KEYS[event.key.toLowerCase()]!;
      armedCancel = OrderCancelCondition.CompleteDisable;
    } else if (ordersAllowed && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === STOP_KEY && picked.length > 0) {
      if (sideOf(snapshot, picked) !== null) issue({ kind: 'stop', ships: picked });
    } else if (event.key === 'f' || event.key === 'F') {
      autoFrame = true;
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
      const restored = rewind.seek(
        seeking,
        () => flashes.clear(),
        (on) => {
          flashes.step(on.dt);
          drain(on.impacts.log);
        },
      );
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
      frame(camera, pickedBounds(view, picked) ?? view, framedWidth, canvas.height, jumped ? 1 : undefined);
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
    picked = stillThere(view, picked);
    selected = viewOf(view, picked[0])?.body ?? -1;
    const also = picked.slice(1).map((i) => viewOf(view, i)?.body ?? -1);
    const markedBody = markedModules === null ? -1 : (viewOf(view, markedModules.ship)?.body ?? -1);
    const marked = markedBody < 0 ? null : { body: markedBody, modules: markedModules!.modules };
    draw(ctx, view, camera, canvas.width, canvas.height, flashes, arcs, teamShots, selected, also, marked);
    if (tiles !== null) drawFleetStrips(ctx, view, tiles, selected, ratio, flashes, arcs, teamShots);
    const insets = closeUps(view, camera, canvas.width, canvas.height, selected, ratio, tiles);
    drawCloseUps(ctx, view, insets, selected, ratio, flashes, arcs, teamShots, marked);
    drawTargetRange(ctx, view, camera, canvas.width, canvas.height, selected, insets, ratio);
    shownStrips = tiles;
    shownInsets = insets;
    if (box !== null) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.strokeStyle = BOX_COLOUR;
      ctx.lineWidth = 1;
      ctx.strokeRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
    }
    drawn(view);
  };
  window.requestAnimationFrame(tick);

  return {
    show(next, run, rewindable = false, orders = []) {
      battle = next;
      picked = [];
      armed = null;
      rewind = rewindable ? new Rewind(next, () => performance.now(), orders) : null;
      seeking = -1;
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
    allowOrders() {
      ordersAllowed = true;
    },
    get picked() {
      return picked;
    },
    get armed() {
      return armed;
    },
    arm(verb, cancelOn = OrderCancelCondition.CompleteDisable) {
      armed = ordersAllowed && picked.length > 0 ? verb : null;
      armedCancel = cancelOn;
    },
    nearest,
    issue,
    pickPart(handler) {
      partPicker = handler;
    },
    mark(next) {
      markedModules = next;
    },
    get orders() {
      return rewind?.orders ?? [];
    },
    screenOf(ship) {
      const seen = viewOf(snapshot, ship);
      if (seen === null) return null;
      const r = canvas.getBoundingClientRect().width / canvas.width;
      return {
        x: ((seen.x - camera.x) * camera.scale + canvas.width / 2) * r,
        y: (-(seen.y - camera.y) * camera.scale + canvas.height / 2) * r,
      };
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
