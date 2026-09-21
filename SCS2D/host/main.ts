import { capture, math, Snapshot } from '../sim/index.js';
import { Flashes } from '../render/flashes.js';
import { duel } from '../scenarios/duel.js';
import { beamDuel } from '../scenarios/beamDuel.js';
import { beamVGun } from '../scenarios/beamVGun.js';
import { fractal } from '../scenarios/fractal.js';
import type { Battle } from '../scenarios/types.js';
import { swarm } from '../scenarios/swarm.js';
import { starWars } from '../scenarios/starWars.js';
import { ram } from '../scenarios/ram.js';
import { standoff } from '../scenarios/standoff.js';
import { column } from '../scenarios/column.js';
import { draw } from '../render/canvas2d.js';
import { frame, gridStep, moveWithVisibleShips, type Camera } from '../render/camera.js';

/**
 * The browser host: owns the clock, the canvas and the controls, and nothing else.
 *
 * **The wall clock lives here and only here.** The simulation takes a fixed
 * step and has no idea what time it is (DESIGN.md non-negotiable 2); this
 * accumulates real elapsed time and decides how many fixed steps to run for it.
 * That is what lets the same battle run at half speed, at eight times speed, or
 * flat out in a headless test, and come out identical.
 */

/** Cap on steps per frame. A tab left in the background must not try to catch up. */
const MAX_STEPS_PER_FRAME = 16;

const SEED = 20260905;

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`missing element #${id}`);
  return found as T;
}

export function start(): void {
  const canvas = el<HTMLCanvasElement>('view');
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('no 2d context');

  const readout = el<HTMLElement>('readout');
  const playButton = el<HTMLButtonElement>('play');
  const stepButton = el<HTMLButtonElement>('step');
  const resetButton = el<HTMLButtonElement>('reset');
  const sceneSelect = el<HTMLSelectElement>('scene');
  const speedInput = el<HTMLInputElement>('speed');
  const speedLabel = el<HTMLElement>('speedLabel');
  const fitButton = el<HTMLButtonElement>('fit');
  const scenes = [
    { name: 'Duel', create: () => duel(SEED) },
    { name: 'Beam Duel', create: () => beamDuel(SEED) },
    { name: 'Star Wars', create: () => starWars(SEED) },
    { name: 'Beam Vs Gun', create: () => beamVGun(SEED) },
    { name: 'Swarm', create: () => swarm(SEED) },
    { name: 'Fractal', create: () => fractal(SEED) },
    { name: 'Super Swarm', create: () => swarm(SEED, 300) },
    { name: 'Ram', create: () => ram(SEED) },
    { name: 'Standoff', create: () => standoff(SEED) },
    { name: 'Line Ahead', create: () => column(SEED) },
  ];
  let sceneIndex = 0;
  let state: Battle = scenes[sceneIndex].create();
  let snapshot = new Snapshot();
  const flashes = new Flashes();
  const camera: Camera = { x: 0, y: 0, scale: 0.1 };
  // Auto-framing keeps everything in shot, which is what you want until you
  // want to look at something. Any manual zoom or pan hands control over;
  // "Fit" gives it back.
  let autoFrame = true;
  let running = true;
  let speed = 1;
  let accumulator = 0;
  let last = 0;
  let framed = false;
  // Simulated time at the last frame, so the camera knows how far the ships
  // have travelled since it last looked — which is not how much wall time
  // passed, once the speed control is off 1x.
  let lastSimTime = 0;

  // Named rather than numbered, and the list is the scenes array itself, so a
  // scenario added there appears here without being mentioned twice.
  for (const scene of scenes) {
    const option = document.createElement('option');
    option.textContent = scene.name;
    sceneSelect.append(option);
  }
  sceneSelect.selectedIndex = sceneIndex;

  const resize = (): void => {
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
  };
  window.addEventListener('resize', resize);
  resize();

  const setRunning = (next: boolean): void => {
    running = next;
    playButton.textContent = running ? 'Pause' : 'Play';
    // Drop whatever time passed while paused, rather than running it off in
    // one burst on resume.
    last = 0;
  };

  playButton.addEventListener('click', () => setRunning(!running));
  stepButton.addEventListener('click', () => {
    setRunning(false);
    state.step();
  });
  resetButton.addEventListener('click', () => {
    state = scenes[sceneIndex].create();
    flashes.clear();
    framed = false;
    autoFrame = true;
    setRunning(true);
  });
  sceneSelect.addEventListener('change', () => {
    sceneIndex = sceneSelect.selectedIndex;
    state = scenes[sceneIndex].create();
    flashes.clear();
    framed = false;
    autoFrame = true;
    setRunning(true);
  });
  fitButton.addEventListener('click', () => {
    autoFrame = true;
  });

  // Zoom about the pointer, so the thing under the cursor stays under it.
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    autoFrame = false;
    const rect = canvas.getBoundingClientRect();
    const ratio = canvas.width / rect.width;
    const px = (event.clientX - rect.left) * ratio - canvas.width / 2;
    const py = (event.clientY - rect.top) * ratio - canvas.height / 2;
    const before = { x: camera.x + px / camera.scale, y: camera.y - py / camera.scale };
    camera.scale *= Math.exp(-event.deltaY * 0.0015);
    camera.x = before.x - px / camera.scale;
    camera.y = before.y + py / camera.scale;
  }, { passive: false });

  let dragging: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (event) => {
    dragging = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (dragging === null) return;
    autoFrame = false;
    const ratio = canvas.width / canvas.getBoundingClientRect().width;
    camera.x -= ((event.clientX - dragging.x) * ratio) / camera.scale;
    camera.y += ((event.clientY - dragging.y) * ratio) / camera.scale;
    dragging = { x: event.clientX, y: event.clientY };
  });
  const endDrag = (): void => {
    dragging = null;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  speedInput.addEventListener('input', () => {
    speed = Number(speedInput.value);
    speedLabel.textContent = `${speed}x`;
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === ' ') {
      event.preventDefault();
      setRunning(!running);
    } else if (event.key === '.') {
      setRunning(false);
      state.step();
    } else if (event.key === 'f' || event.key === 'F') {
      autoFrame = true;
    }
  });

  const tick = (now: number): void => {
    if (last === 0) last = now;
    const elapsed = Math.min((now - last) / 1000, 0.25);
    last = now;

    if (running) {
      accumulator += elapsed * speed;
      let steps = 0;
      while (accumulator >= state.dt && steps < MAX_STEPS_PER_FRAME) {
        state.step();
        accumulator -= state.dt;
        steps++;
      }
      // Whatever could not be run this frame is dropped rather than owed:
      // falling behind should slow the battle down, not queue up a lurch.
      if (steps === MAX_STEPS_PER_FRAME) accumulator = 0;
    }

    const view = capture(
      snapshot,
      state.world,
      state.ships,
      state.projectiles,
      state.beams,
      state.wells,
      state.impacts.log,
    );
    // Negative when the battle has just been reset, which is not elapsed time.
    const simDt = view.time > lastSimTime ? view.time - lastSimTime : 0;
    lastSimTime = view.time;

    moveWithVisibleShips(camera, view, simDt, canvas.width, canvas.height);
    if (autoFrame) {
      if (!framed) {
        // Snap to the opening positions rather than easing in from nowhere.
        frame(camera, view, canvas.width, canvas.height, 1);
        framed = true;
      }
      frame(camera, view, canvas.width, canvas.height);
    }

    // Impacts belong to the battle, so they fade on *its* clock: a paused
    // battle holds its flashes, a single step advances them by one step, and
    // eight times speed burns them off eight times as fast.
    for (let i = 0; i < view.impactCount; i++) {
      flashes.add(
        view.impactX[i]!,
        view.impactY[i]!,
        view.impactEnergy[i]!,
        view.impactKind[i]!,
        view.impactBody[i]!,
        view.impactLocalX[i]!,
        view.impactLocalY[i]!,
      );
    }
    flashes.step(simDt);
    draw(ctx, view, camera, canvas.width, canvas.height, flashes);

    // Between the first two ships, whatever the scenario holds — but only if
    // there are two. A single survivor has nothing to measure against, and
    // reading past the end of the list would take the viewer down with it.
    const first = view.ships[0];
    const second = view.ships[1];
    const range =
      first !== undefined && second !== undefined
        ? math.distance(first.x, first.y, second.x, second.y)
        : 0;
    readout.textContent =
      `t ${view.time.toFixed(1)} s · step ${view.tick} · ` +
      // Metres suit a duel and tell you nothing about two near-identical
      // designs flying almost on top of each other.
      `range ${range.toFixed(range < 10 ? 3 : 0)} m · in flight ${view.projectileCount} · ` +
      `p.fired ${state.totalProjectilesFired} · p.hits ${state.totalProjectileHits} · ` +
      `b.fired ${state.totalBeamsFired} · b.hits ${state.totalBeamHits} · ` +
      `severed ${state.totalSevered} · scrap ${(state.ships.discarded / 1000).toFixed(1)} t · ` +
      `grid ${gridStep(camera.scale)} m`;

    window.requestAnimationFrame(tick);
  };

  window.requestAnimationFrame(tick);
}
