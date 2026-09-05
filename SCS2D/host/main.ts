import { capture, math, Snapshot } from '../sim/index.js';
import { duel, type Duel } from '../scenarios/duel.js';
import { draw, frame, gridStep, type Camera } from '../render/canvas2d.js';

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
  const speedInput = el<HTMLInputElement>('speed');
  const speedLabel = el<HTMLElement>('speedLabel');

  let state: Duel = duel(SEED);
  let snapshot = new Snapshot();
  let camera: Camera = { x: 0, y: 0, scale: 0.1 };
  let running = true;
  let speed = 1;
  let accumulator = 0;
  let last = 0;
  let framed = false;

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
    state = duel(SEED);
    framed = false;
    setRunning(true);
  });
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

    const view = capture(snapshot, state.world, state.ships, state.projectiles);
    if (!framed) {
      // Snap to the opening positions rather than easing in from nowhere.
      frame(camera, view, canvas.width, canvas.height, 1);
      framed = true;
    }
    frame(camera, view, canvas.width, canvas.height);
    draw(ctx, view, camera, canvas.width, canvas.height);

    const range =
      view.shipCount === 2
        ? math.distance(
            view.ships[0]!.x,
            view.ships[0]!.y,
            view.ships[1]!.x,
            view.ships[1]!.y,
          )
        : 0;
    readout.textContent =
      `t ${view.time.toFixed(1)} s · step ${view.tick} · ` +
      `range ${range.toFixed(0)} m · in flight ${view.projectileCount} · ` +
      `fired ${state.totalFired} · hits ${state.totalHits} · grid ${gridStep(camera.scale)} m`;

    window.requestAnimationFrame(tick);
  };

  window.requestAnimationFrame(tick);
}
