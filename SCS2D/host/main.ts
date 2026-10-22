import { BATTLE_KEYS, keyHelp, ORDER_KEYS } from './keyHelp.js';
import { math } from '../sim/index.js';
import { duel } from '../scenarios/duel.js';
import { beamDuel } from '../scenarios/beamDuel.js';
import type { Battle } from '../scenarios/types.js';
import { swarm } from '../scenarios/swarm.js';
import { torpedoes } from '../scenarios/torpedoes.js';
import { starWars } from '../scenarios/starWars.js';
import { standoff } from '../scenarios/standoff.js';
import { column } from '../scenarios/column.js';
import { split } from '../scenarios/split.js';
import { torchRun } from '../scenarios/torchRun.js';
import { binary } from '../scenarios/binary.js';
import { kernels } from '../scenarios/kernels.js';
import { asteroidField } from '../scenarios/asteroidField.js';
import { broadside } from '../scenarios/broadside.js';
import { hooked } from '../scenarios/hooked.js';
import { salvageRun } from '../scenarios/salvage.js';
import { catamaranRefits, mending, refitting } from '../scenarios/mending.js';
import { scavenge } from '../scenarios/scavenge.js';
import { factory, padRebuild } from '../scenarios/carrier.js';
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
import { doctrinePanel } from './doctrinePanel.js';
import { orderBar } from './orderBar.js';
import { battleControls } from './battleControls.js';
import type { Logged } from '../scenarios/commands.js';
import { el } from './dom.js';
import { choices } from './designChoices.js';
import { teamName } from '../render/teams.js';

/**
 * The scenarios page: a battle picked from the list, or set up as a custom
 * battle, run on the wall clock by `battleView`.
 */

const SEED = 20260905;

export function start(): void {
  keyHelp(
    el<HTMLElement>('hint'),
    [...BATTLE_KEYS, ...ORDER_KEYS],
    [
      'Blue, red, green and magenta are the sides; grey is a side beyond the fourth, or a hulk.',
      'The ring marks where the gravity well pulls at 1 m/s².',
    ],
  );
  const readout = el<HTMLElement>('readout');
  const metrics = el<HTMLElement>('metrics');
  const playButton = el<HTMLButtonElement>('play');
  const stepButton = el<HTMLButtonElement>('step');
  const resetButton = el<HTMLButtonElement>('reset');
  const sceneSelect = el<HTMLSelectElement>('scene');
  const speedSelect = el<HTMLSelectElement>('speed');
  const fitButton = el<HTMLButtonElement>('fit');
  const scrub = el<HTMLInputElement>('scrub');
  const scenes = [
    { name: 'Duel', create: () => duel(SEED) },
    { name: 'Beam Duel', create: () => beamDuel(SEED) },
    { name: 'Star Wars', create: () => starWars(SEED) },
    { name: 'Swarm', create: () => swarm(SEED) },
    { name: 'Super Swarm', create: () => swarm(SEED, 300) },
    { name: 'Torpedoes', create: () => torpedoes(SEED) },
    { name: 'Standoff', create: () => standoff(SEED) },
    { name: 'Line Ahead', create: () => column(SEED) },
    { name: 'Split', create: () => split(SEED) },
    { name: 'Torch Run', create: () => torchRun(SEED) },
    { name: 'Binary', create: () => binary(SEED) },
    { name: 'Kernels', create: () => kernels(SEED) },
    { name: 'Asteroid Field', create: () => asteroidField(SEED) },
    { name: 'Hooked', create: () => hooked(SEED) },
    { name: 'Broadside', create: () => broadside(SEED) },
    { name: 'Salvage Run', create: () => salvageRun(SEED) },
    { name: 'Mending', create: () => mending(SEED) },
    { name: 'Refitting', create: () => refitting(SEED) },
    { name: 'Catamaran Refits', create: () => catamaranRefits(SEED) },
    { name: 'Scavenge', create: () => scavenge(SEED) },
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
  /** The orders a link carried, for the battle it opens and no other. */
  let linkedOrders: readonly Logged[] = [];
  /** Build the current scene afresh, running or held at its first step: by default, whichever it was. */
  const restart = (run = view.running): void => {
    state = scenes[sceneIndex]!.create();
    panel.reset();
    view.show(state, run, true, linkedOrders);
    linkedOrders = [];
  };
  // A custom battle is set up paused at its first step, so the opening
  // positions can be seen as they are chosen, and started with Fight.
  const openCustom = (): void => {
    sceneIndex = CUSTOM;
    sceneSelect.selectedIndex = CUSTOM;
    panel.show(true);
    restart(false);
  };
  const panel = customPanel(
    openCustom,
    () => restart(true),
    () => view.orders,
  );
  let sceneIndex = 0;
  let state: Battle = scenes[sceneIndex]!.create();

  const view = battleView(
    el<HTMLCanvasElement>('view'),
    () => {},
    (shown) => {
      bar.update(shown);
      doctrine.update(shown);
      if (sceneIndex === CUSTOM) panel.update(state as CustomBattle, shown.time);
      // Between the first two ships, whatever the scenario holds — but only if
      // there are two. A single survivor has nothing to measure against.
      const first = shown.ships[0];
      const second = shown.ships[1];
      const range = first !== undefined && second !== undefined ? math.distance(first.x, first.y, second.x, second.y) : 0;
      readout.textContent = `t ${shown.time.toFixed(1)} s · step ${shown.tick} · grid ${gridStep(view.camera.scale)} m`;
      scrub.max = String(view.reached);
      if (!scrubbing) scrub.value = String(view.at);
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
    (rewound) => {
      state = rewound;
      panel.reset();
    },
  );
  battleControls(el<HTMLElement>('stage'));
  const bar = orderBar(view);
  const doctrine = doctrinePanel(view);
  view.allowOrders();
  // For the browser tests and anyone inspecting the page.
  Reflect.set(window, 'viewer', view);
  view.show(state, true, true);

  // Named rather than numbered, and the list is the scenes array itself, so a
  // scenario added there appears here without being mentioned twice.
  for (const scene of scenes) {
    const option = document.createElement('option');
    option.textContent = scene.name;
    sceneSelect.append(option);
  }
  sceneSelect.selectedIndex = sceneIndex;

  // Paused while held, and the thumb left where it is dragged rather than pulled back to the battle.
  let scrubbing = false;
  let resume = false;
  scrub.addEventListener('pointerdown', () => {
    scrubbing = true;
    resume = view.running;
    view.setRunning(false);
  });
  window.addEventListener('pointerup', () => {
    if (!scrubbing) return;
    scrubbing = false;
    if (resume) view.setRunning(true);
  });
  scrub.addEventListener('input', () => view.seek(Number(scrub.value)));

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

  // Adding a ship: the library's designs, read again on coming back to the page, and a side to add it to.
  const addShip = el<HTMLSelectElement>('addShip');
  const addSide = el<HTMLSelectElement>('addSide');
  let library = choices();
  const listDesigns = (): void => {
    // Not while one is being placed: the list shows which.
    if (view.placing) return;
    library = choices();
    addShip.replaceChildren(addShip.options[0]!);
    library.forEach((choice, k) => addShip.add(new Option(choice.label, String(k))));
  };
  listDesigns();
  window.addEventListener('focus', listDesigns);
  for (let team = 0; team < 4; team++) addSide.add(new Option(teamName(team), String(team)));
  addShip.addEventListener('change', () => {
    const choice = addShip.value === '' ? undefined : library[Number(addShip.value)];
    addShip.blur();
    // The list shows what is being placed until it is placed or given up, and the side is the one chosen by then.
    view.place(
      choice === undefined ? null : { blueprint: choice.blueprint, team: () => Number(addSide.value), ended: () => (addShip.value = '') },
    );
  });

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
      panel.use(linked.setup, 'link');
      linkedOrders = linked.orders;
      openCustom();
    })
    .catch((error: unknown) => {
      window.alert(`Could not read the battle in the link.\n\n${error instanceof Error ? error.message : error}`);
    });
  if (hash !== '') history.replaceState(null, '', window.location.pathname);
}
