import { math } from '../sim/index.js';
import { duel } from '../scenarios/duel.js';
import { beamDuel } from '../scenarios/beamDuel.js';
import { beamVGun } from '../scenarios/beamVGun.js';
import { fractal } from '../scenarios/fractal.js';
import type { Battle } from '../scenarios/types.js';
import { swarm } from '../scenarios/swarm.js';
import { torpedoes } from '../scenarios/torpedoes.js';
import { starWars } from '../scenarios/starWars.js';
import { ram } from '../scenarios/ram.js';
import { standoff } from '../scenarios/standoff.js';
import { column } from '../scenarios/column.js';
import { split } from '../scenarios/split.js';
import { torchRun } from '../scenarios/torchRun.js';
import { broadside } from '../scenarios/broadside.js';
import { hooked } from '../scenarios/hooked.js';
import { salvage, salvageRun, scrapyard } from '../scenarios/salvage.js';
import { mending, rebuilding, refitting } from '../scenarios/mending.js';
import { scavenge } from '../scenarios/scavenge.js';
import { carrier, factory, padRebuild } from '../scenarios/carrier.js';
import { shipyard } from '../scenarios/shipyard.js';
import { beamCarrier } from '../scenarios/beamCarrier.js';
import { circling, passes } from '../scenarios/passes.js';
import { rearm } from '../scenarios/rearm.js';
import { tanker } from '../scenarios/tanker.js';
import { customBattle, type CustomBattle } from '../scenarios/customBattle.js';
import { customPanel } from './customPanel.js';
import { linkedBattle } from '../scenarios/battleLink.js';
import { handedFleet } from '../editor/handoff.js';
import { gridStep } from '../render/camera.js';
import { battleView } from './battleView.js';
import { el } from './dom.js';

/**
 * The scenarios page: a battle picked from the list, or set up as a custom
 * battle, run on the wall clock by `battleView`.
 */

const SEED = 20260905;

export function start(): void {
  const readout = el<HTMLElement>('readout');
  const metrics = el<HTMLElement>('metrics');
  const playButton = el<HTMLButtonElement>('play');
  const stepButton = el<HTMLButtonElement>('step');
  const resetButton = el<HTMLButtonElement>('reset');
  const sceneSelect = el<HTMLSelectElement>('scene');
  const speedSelect = el<HTMLSelectElement>('speed');
  const fitButton = el<HTMLButtonElement>('fit');
  const scenes = [
    { name: 'Duel', create: () => duel(SEED) },
    { name: 'Beam Duel', create: () => beamDuel(SEED) },
    { name: 'Star Wars', create: () => starWars(SEED) },
    { name: 'Beam Vs Gun', create: () => beamVGun(SEED) },
    { name: 'Swarm', create: () => swarm(SEED) },
    { name: 'Fractal', create: () => fractal(SEED) },
    { name: 'Super Swarm', create: () => swarm(SEED, 300) },
    { name: 'Torpedoes', create: () => torpedoes(SEED) },
    { name: 'Ram', create: () => ram(SEED) },
    { name: 'Standoff', create: () => standoff(SEED) },
    { name: 'Line Ahead', create: () => column(SEED) },
    { name: 'Split', create: () => split(SEED) },
    { name: 'Torch Run', create: () => torchRun(SEED) },
    { name: 'Hooked', create: () => hooked(SEED) },
    { name: 'Broadside', create: () => broadside(SEED) },
    { name: 'Salvage', create: () => salvage(SEED) },
    { name: 'Scrapyard', create: () => scrapyard(SEED) },
    { name: 'Salvage Run', create: () => salvageRun(SEED) },
    { name: 'Mending', create: () => mending(SEED) },
    { name: 'Rebuilding', create: () => rebuilding(SEED) },
    { name: 'Refitting', create: () => refitting(SEED) },
    { name: 'Scavenge', create: () => scavenge(SEED) },
    { name: 'Carrier', create: () => carrier(SEED) },
    { name: 'Pad Rebuild', create: () => padRebuild(SEED) },
    { name: 'Factory', create: () => factory(SEED) },
    { name: 'Shipyard', create: () => shipyard(SEED) },
    { name: 'Rearm', create: () => rearm(SEED) },
    { name: 'Tanker', create: () => tanker(SEED) },
    { name: 'Beam Carrier', create: () => beamCarrier(SEED) },
    { name: 'Passes', create: () => passes(SEED) },
    { name: 'Circling', create: () => circling(SEED) },
    // Last, and built from the panel's setup rather than from code.
    { name: 'Custom battle', create: (): Battle => customBattle(panel.setup()) },
  ];
  const CUSTOM = scenes.length - 1;
  /** Build the current scene afresh, running or held at its first step: by default, whichever it was. */
  const restart = (run = view.running): void => {
    state = scenes[sceneIndex]!.create();
    panel.reset();
    view.show(state, run);
  };
  // A custom battle is set up paused at its first step, so the opening
  // positions can be seen as they are chosen, and started with Fight.
  const openCustom = (): void => {
    sceneIndex = CUSTOM;
    sceneSelect.selectedIndex = CUSTOM;
    panel.show(true);
    restart(false);
  };
  const panel = customPanel(openCustom, () => restart(true));
  let sceneIndex = 0;
  let state: Battle = scenes[sceneIndex]!.create();

  const view = battleView(
    el<HTMLCanvasElement>('view'),
    () => {},
    (shown) => {
      if (sceneIndex === CUSTOM) panel.update(state as CustomBattle, shown.time);
      // Between the first two ships, whatever the scenario holds — but only if
      // there are two. A single survivor has nothing to measure against.
      const first = shown.ships[0];
      const second = shown.ships[1];
      const range =
        first !== undefined && second !== undefined ? math.distance(first.x, first.y, second.x, second.y) : 0;
      readout.textContent = `t ${shown.time.toFixed(1)} s · step ${shown.tick} · grid ${gridStep(view.camera.scale)} m`;
      // Not shown: kept for the browser tests and anyone inspecting the page.
      metrics.textContent =
        `range ${range.toFixed(range < 10 ? 3 : 0)} m · in flight ${shown.projectileCount} · ` +
        `p.fired ${state.totalProjectilesFired} · p.hits ${state.totalProjectileHits} · ` +
        `b.fired ${state.totalBeamsFired} · b.hits ${state.totalBeamHits} · ` +
        `severed ${state.totalSevered} · scrap ${(state.ships.discarded / 1000).toFixed(1)} t`;
    },
    (running) => {
      playButton.textContent = running ? 'Pause' : 'Play';
    },
  );
  view.show(state, true);

  // Named rather than numbered, and the list is the scenes array itself, so a
  // scenario added there appears here without being mentioned twice.
  for (const scene of scenes) {
    const option = document.createElement('option');
    option.textContent = scene.name;
    sceneSelect.append(option);
  }
  sceneSelect.selectedIndex = sceneIndex;

  playButton.addEventListener('click', () => view.setRunning(!view.running));
  stepButton.addEventListener('click', () => view.step());
  resetButton.addEventListener('click', () => restart(sceneIndex !== CUSTOM && view.running));
  sceneSelect.addEventListener('change', () => {
    if (sceneSelect.selectedIndex === CUSTOM) {
      openCustom();
      return;
    }
    sceneIndex = sceneSelect.selectedIndex;
    panel.show(false);
    restart();
  });
  el<HTMLButtonElement>('customBattle').addEventListener('click', openCustom);
  fitButton.addEventListener('click', () => view.fit());

  view.keep('viewer', speedSelect);
  speedSelect.addEventListener('change', () => view.setSpeed(Number(speedSelect.value)));
  // An editor's Battle link carries what it holds: open straight into a custom
  // battle with it as the first side, paused for the rest to be chosen.
  try {
    const handed = handedFleet(window.location.hash);
    if (handed !== null) {
      panel.load(handed, `${handed.name} (from the editor)`);
      openCustom();
    }
  } catch (error) {
    window.alert(`Could not read the fleet handed over.\n\n${error instanceof Error ? error.message : error}`);
  }
  // A shared link carries a whole battle: open on it, paused at its start.
  const hash = window.location.hash;
  void linkedBattle(hash)
    .then((linked) => {
      if (linked === null) return;
      panel.use(linked, 'link');
      openCustom();
    })
    .catch((error: unknown) => {
      window.alert(`Could not read the battle in the link.\n\n${error instanceof Error ? error.message : error}`);
    });
  if (hash !== '') history.replaceState(null, '', window.location.pathname);

}
