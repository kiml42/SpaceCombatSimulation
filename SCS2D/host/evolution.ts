import { capture, parseBlueprint, Snapshot, type Blueprint } from '../sim/index.js';
import { Flashes } from '../render/flashes.js';
import { draw } from '../render/canvas2d.js';
import { drawChart, type Series } from '../render/chart.js';
import { frame, moveWithVisibleShips, type Camera } from '../render/camera.js';
import { Library, toFileText } from '../editor/library.js';
import { previewSnapshot } from '../editor/preview.js';
import { compileBlueprint } from '../sim/index.js';
import { fitness } from '../evolution/generation.js';
import { DEFAULT_MATCH, Match, type MatchConfig } from '../evolution/match.js';
import { DEFAULT_KINDS, type KindWeights } from '../evolution/mutate.js';
import { parseRunConfig, serialiseRunConfig, type RunSetup } from '../evolution/configFile.js';
import { latest, Yardstick, type YardstickReport } from '../evolution/yardstick.js';
import {
  finalist,
  DEFAULT_RUN,
  Run,
  type GenerationRecord,
  type MatchRecord,
  type RunConfig,
} from '../evolution/run.js';
import { el } from './dom.js';

/**
 * The evolution page: set a run going, watch what it is doing, and fight any
 * match in it again.
 *
 * **The run is stepped on this page's clock, not run on a thread of its own.**
 * A generation is minutes of simulation, so the work is taken in slices a few
 * milliseconds long between frames — which keeps the page answering, and means
 * what is drawn is the match the run is actually fighting rather than a
 * re-enactment of it. A worker would be faster and is not what this is for:
 * the point of the page is to see what a run is doing while it does it.
 */

/** Cap on replay steps per frame, so a tab left in the background cannot catch up in one lurch. */
const MAX_STEPS_PER_FRAME = 16;

/** What the settings are saved under, so a refresh does not cost them. */
const SETUP_KEY = 'scs2d.evolution.setup';

const FIELDS = [
  'generations',
  'population',
  'winners',
  'group',
  'minMatches',
  'massBudget',
  'seed',
  'duration',
  'radius',
  'scatter',
  'survivalWeight',
  'damageWeight',
  'raceWeight',
  'kindThruster',
  'kindStructure',
  'kindTurret',
  'kindBeamTurret',
  'kindHullGun',
  'kindHullBeam',
  'kindCore',
  'effort',
] as const;

/** One line of the results table, from a finished generation or a live one. */
interface Row {
  readonly id: number;
  readonly parent: number;
  readonly matches: number;
  readonly fitness: number;
  readonly survival: number;
  readonly damage: number;
  readonly race: number;
  readonly mass: number;
  readonly edits: readonly string[];
  readonly blueprint: Blueprint;
}

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('no 2d context');
  return ctx;
}

function number(input: HTMLInputElement, fallback: number): number {
  const value = Number(input.value);
  return input.value.trim() === '' || !Number.isFinite(value) ? fallback : value;
}

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function startEvolution(): void {
  const view = el<HTMLCanvasElement>('view');
  const chart = el<HTMLCanvasElement>('chart');
  // Typed rather than narrowed: `paint` is hoisted, and a hoisted function
  // cannot see a narrowing made after it in the source.
  const ctx: CanvasRenderingContext2D = context(view);
  const chartCtx: CanvasRenderingContext2D = context(chart);

  const startButton = el<HTMLButtonElement>('start');
  const pauseButton = el<HTMLButtonElement>('pause');
  const stopButton = el<HTMLButtonElement>('stop');
  const stateLabel = el<HTMLElement>('state');
  const readout = el<HTMLElement>('readout');
  const barFill = el<HTMLElement>('barFill');
  const foundersSelect = el<HTMLSelectElement>('founders');
  const goalInput = el<HTMLInputElement>('goal');
  const playButton = el<HTMLButtonElement>('play');
  const stepButton = el<HTMLButtonElement>('step');
  const fitButton = el<HTMLButtonElement>('fit');
  const speedSelect = el<HTMLSelectElement>('speed');
  const modeSelect = el<HTMLSelectElement>('mode');
  const rollingInput = el<HTMLInputElement>('rolling');
  const battleControls = el<HTMLElement>('battleControls');
  const fleetBox = el<HTMLElement>('fleet');
  const watchingLabel = el<HTMLElement>('watching');
  const generationSelect = el<HTMLSelectElement>('generation');
  const shownGeneration = el<HTMLElement>('shownGeneration');
  const shipsBody = el<HTMLElement>('ships');
  const matchesBody = el<HTMLElement>('matches');
  const editsLine = el<HTMLElement>('edits');
  const championLine = el<HTMLElement>('championLine');
  const saveButton = el<HTMLButtonElement>('saveChampion');
  const exportButton = el<HTMLButtonElement>('exportChampion');
  const benchmarkSelect = el<HTMLSelectElement>('benchmark');
  const measureButton = el<HTMLButtonElement>('measure');
  const yardstickLine = el<HTMLElement>('yardstickLine');
  const inputs = Object.fromEntries(
    FIELDS.map((name) => [name, el<HTMLInputElement>(name)]),
  ) as Record<(typeof FIELDS)[number], HTMLInputElement>;

  const library = new Library(window.localStorage);

  let run: Run | null = null;
  let paused = false;
  let replay: Match | null = null;
  let replayOf: MatchRecord | null = null;
  let replayPlaying = true;
  let watchedMatch: Match | null = null;
  // Which generation the results panel is showing, or -1 to follow the newest.
  let shown = -1;
  let yardstick: Yardstick | null = null;
  let measured: YardstickReport | null = null;
  /** Which generation the fleet tiles were built for, and the tiles by ship. */
  let fleetOf = -1;
  const fleetTiles = new Map<number, { figure: HTMLElement; caption: HTMLElement }>();
  const fleetSnapshot = new Snapshot();
  let picked = -1;
  // Where the rolling replay has got to, and how many matches there were when
  // it last chose — a match arriving while one plays jumps the queue.
  let rollingAt = 0;
  let rollingSeen = 0;
  const snapshot = new Snapshot();
  const flashes = new Flashes();
  const camera: Camera = { x: 0, y: 0, scale: 0.1 };
  let autoFrame = true;
  let framed = false;
  let lastSimTime = 0;
  let accumulator = 0;
  let last = 0;
  // Compiling a hull to weigh it is not free, and the panel is redrawn many
  // times a run; an individual's mass never changes, and its id never repeats.
  const masses = new Map<number, number>();
  let refreshedAt = 0;

  // ---- settings ----------------------------------------------------------

  const defaults: Record<(typeof FIELDS)[number], string> = {
    generations: String(DEFAULT_RUN.generations),
    population: String(DEFAULT_RUN.population),
    winners: String(DEFAULT_RUN.winners),
    group: String(DEFAULT_RUN.group),
    minMatches: String(DEFAULT_RUN.minMatches),
    massBudget: '',
    seed: String(DEFAULT_RUN.seed),
    duration: String(DEFAULT_MATCH.duration),
    radius: String(DEFAULT_MATCH.radius),
    scatter: String(Math.round((DEFAULT_MATCH.scatter * 180) / Math.PI)),
    survivalWeight: String(DEFAULT_MATCH.weights.survival),
    damageWeight: String(DEFAULT_MATCH.weights.damage),
    raceWeight: String(DEFAULT_MATCH.weights.race),
    kindThruster: String(DEFAULT_KINDS.thruster),
    kindStructure: String(DEFAULT_KINDS.structure),
    kindTurret: String(DEFAULT_KINDS.turret),
    kindBeamTurret: String(DEFAULT_KINDS.beamTurret),
    kindHullGun: String(DEFAULT_KINDS.hullGun),
    kindHullBeam: String(DEFAULT_KINDS.hullBeam),
    kindCore: String(DEFAULT_KINDS.core),
    effort: '12',
  };

  const saveSetup = (): void => {
    const held: Record<string, string> = { goal: goalInput.checked ? '1' : '' };
    for (const name of FIELDS) held[name] = inputs[name].value;
    held['founders'] = [...foundersSelect.selectedOptions].map((o) => o.value).join('\n');
    try {
      window.localStorage.setItem(SETUP_KEY, JSON.stringify(held));
    } catch {
      // Storage being full or refused costs the settings, not the run.
    }
  };

  const loadSetup = (): Record<string, string> => {
    try {
      const raw = window.localStorage.getItem(SETUP_KEY);
      if (raw !== null) return JSON.parse(raw) as Record<string, string>;
    } catch {
      // Same: unreadable settings are settings that were never saved.
    }
    return {};
  };

  const held = loadSetup();
  for (const name of FIELDS) inputs[name].value = held[name] ?? defaults[name];
  goalInput.checked = held['goal'] === undefined ? true : held['goal'] !== '';

  const wanted = new Set((held['founders'] ?? 'Corvette').split('\n'));
  for (const entry of library.list()) {
    const option = document.createElement('option');
    option.value = entry.name;
    option.textContent = entry.saved && !entry.builtIn ? `${entry.name} (saved)` : entry.name;
    option.selected = wanted.has(entry.name);
    foundersSelect.append(option);
  }
  if (foundersSelect.selectedOptions.length === 0 && foundersSelect.options.length > 0) {
    foundersSelect.options[0]!.selected = true;
  }

  const OWN_FINAL = '';
  const ownOption = document.createElement('option');
  ownOption.value = OWN_FINAL;
  ownOption.textContent = 'its own final design';
  benchmarkSelect.append(ownOption);
  for (const entry of library.list()) {
    const option = document.createElement('option');
    option.value = entry.name;
    option.textContent = entry.name;
    benchmarkSelect.append(option);
  }

  for (const name of FIELDS) inputs[name].addEventListener('change', saveSetup);
  goalInput.addEventListener('change', saveSetup);
  foundersSelect.addEventListener('change', saveSetup);

  const configure = (): Partial<RunConfig> => {
    const tonnes = number(inputs.massBudget, 0);
    return {
      seed: number(inputs.seed, DEFAULT_RUN.seed),
      generations: Math.max(1, Math.round(number(inputs.generations, DEFAULT_RUN.generations))),
      population: Math.max(2, Math.round(number(inputs.population, DEFAULT_RUN.population))),
      winners: Math.max(1, Math.round(number(inputs.winners, DEFAULT_RUN.winners))),
      group: Math.max(2, Math.round(number(inputs.group, DEFAULT_RUN.group))),
      minMatches: Math.max(1, Math.round(number(inputs.minMatches, DEFAULT_RUN.minMatches))),
      massBudget: tonnes > 0 ? tonnes * 1000 : Infinity,
      mutation: {
        kinds: {
          thruster: Math.max(0, number(inputs.kindThruster, DEFAULT_KINDS.thruster)),
          structure: Math.max(0, number(inputs.kindStructure, DEFAULT_KINDS.structure)),
          turret: Math.max(0, number(inputs.kindTurret, DEFAULT_KINDS.turret)),
          beamTurret: Math.max(0, number(inputs.kindBeamTurret, DEFAULT_KINDS.beamTurret)),
          hullGun: Math.max(0, number(inputs.kindHullGun, DEFAULT_KINDS.hullGun)),
          hullBeam: Math.max(0, number(inputs.kindHullBeam, DEFAULT_KINDS.hullBeam)),
          core: Math.max(0, number(inputs.kindCore, DEFAULT_KINDS.core)),
        },
      },
      match: {
        duration: Math.max(1, number(inputs.duration, DEFAULT_MATCH.duration)),
        radius: Math.max(10, number(inputs.radius, DEFAULT_MATCH.radius)),
        scatter: (number(inputs.scatter, 180) * Math.PI) / 180,
        goal: goalInput.checked ? DEFAULT_MATCH.goal : null,
        weights: {
          survival: number(inputs.survivalWeight, 1),
          damage: number(inputs.damageWeight, 1),
          race: number(inputs.raceWeight, 1),
        },
      },
    };
  };

  /** Everything the form says, as a run's settings. */
  const readSetup = (): RunSetup => ({
    founders: [...foundersSelect.selectedOptions].map((option) => option.value),
    config: { ...DEFAULT_RUN, ...configure() },
  });

  /**
   * Put a setup into the form.
   *
   * A ship the library does not have is dropped rather than refused: a config
   * is worth reading for its numbers even when it names somebody else's ship,
   * and what is missing is visible in the founders list.
   */
  const applySetup = (setup: RunSetup): void => {
    const config = setup.config;
    const match: MatchConfig = { ...DEFAULT_MATCH, ...config.match };
    const kinds: KindWeights = { ...DEFAULT_KINDS, ...config.mutation.kinds };
    inputs.seed.value = String(config.seed);
    inputs.generations.value = String(config.generations);
    inputs.population.value = String(config.population);
    inputs.winners.value = String(config.winners);
    inputs.group.value = String(config.group);
    inputs.minMatches.value = String(config.minMatches);
    inputs.massBudget.value = Number.isFinite(config.massBudget) ? String(config.massBudget / 1000) : '';
    inputs.duration.value = String(match.duration);
    inputs.radius.value = String(match.radius);
    inputs.scatter.value = String((match.scatter * 180) / Math.PI);
    inputs.survivalWeight.value = String(match.weights.survival);
    inputs.damageWeight.value = String(match.weights.damage);
    inputs.raceWeight.value = String(match.weights.race);
    inputs.kindThruster.value = String(kinds.thruster);
    inputs.kindStructure.value = String(kinds.structure);
    inputs.kindTurret.value = String(kinds.turret);
    inputs.kindBeamTurret.value = String(kinds.beamTurret);
    inputs.kindHullGun.value = String(kinds.hullGun);
    inputs.kindHullBeam.value = String(kinds.hullBeam);
    inputs.kindCore.value = String(kinds.core);
    goalInput.checked = match.goal !== null;
    if (setup.founders.length > 0) {
      const named = new Set(setup.founders);
      for (const option of foundersSelect.options) option.selected = named.has(option.value);
    }
    saveSetup();
  };

  el<HTMLButtonElement>('exportConfig').addEventListener('click', () => {
    download('evolution-config.json', `${JSON.stringify(serialiseRunConfig(readSetup()), null, 2)}\n`);
  });
  const file = el<HTMLInputElement>('importConfigFile');
  el<HTMLButtonElement>('importConfig').addEventListener('click', () => file.click());
  file.addEventListener('change', () => {
    const chosen = file.files?.[0];
    if (chosen === undefined) return;
    void chosen.text().then((text) => {
      try {
        applySetup(parseRunConfig(JSON.parse(text)));
      } catch (error) {
        window.alert(`Could not read those settings.\n\n${error instanceof Error ? error.message : error}`);
        return;
      }
      readout.className = '';
      readout.textContent = 'Settings read from a file. Press Start when you are ready.';
    });
    // Cleared so that choosing the same file twice is two imports rather
    // than one, which matters while a file is being edited beside the page.
    file.value = '';
  });

  // ---- the viewer --------------------------------------------------------

  const resize = (): void => {
    const ratio = window.devicePixelRatio || 1;
    for (const canvas of [view, chart]) {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.round(rect.width * ratio);
      canvas.height = Math.round(rect.height * ratio);
    }
    paint();
  };

  const watch = (match: Match | null): void => {
    if (match === watchedMatch) return;
    watchedMatch = match;
    flashes.clear();
    framed = false;
    autoFrame = true;
    lastSimTime = 0;
    accumulator = 0;
  };

  fitButton.addEventListener('click', () => {
    autoFrame = true;
  });
  playButton.addEventListener('click', () => {
    replayPlaying = !replayPlaying;
    playButton.textContent = replayPlaying ? 'Pause' : 'Play';
    last = 0;
  });
  stepButton.addEventListener('click', () => {
    replayPlaying = false;
    playButton.textContent = 'Play';
    if (replay !== null && !replay.done) replay.advance();
  });

  view.addEventListener('wheel', (event) => {
    event.preventDefault();
    autoFrame = false;
    const rect = view.getBoundingClientRect();
    const ratio = view.width / rect.width;
    const px = (event.clientX - rect.left) * ratio - view.width / 2;
    const py = (event.clientY - rect.top) * ratio - view.height / 2;
    const before = { x: camera.x + px / camera.scale, y: camera.y - py / camera.scale };
    camera.scale *= Math.exp(-event.deltaY * 0.0015);
    camera.x = before.x - px / camera.scale;
    camera.y = before.y + py / camera.scale;
  }, { passive: false });

  let dragging: { x: number; y: number } | null = null;
  view.addEventListener('pointerdown', (event) => {
    dragging = { x: event.clientX, y: event.clientY };
    view.setPointerCapture(event.pointerId);
  });
  view.addEventListener('pointermove', (event) => {
    if (dragging === null) return;
    autoFrame = false;
    const ratio = view.width / view.getBoundingClientRect().width;
    camera.x -= ((event.clientX - dragging.x) * ratio) / camera.scale;
    camera.y += ((event.clientY - dragging.y) * ratio) / camera.scale;
    dragging = { x: event.clientX, y: event.clientY };
  });
  const endDrag = (): void => {
    dragging = null;
  };
  view.addEventListener('pointerup', endDrag);
  view.addEventListener('pointercancel', endDrag);

  function paint(): void {
    const match = watchedMatch;
    if (match === null) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#0d1219';
      ctx.fillRect(0, 0, view.width, view.height);
      return;
    }
    const battle = match.battle;
    const shot = capture(
      snapshot,
      battle.world,
      battle.ships,
      battle.projectiles,
      battle.beams,
      battle.wells,
      battle.impacts.log,
    );
    const simDt = shot.time > lastSimTime ? shot.time - lastSimTime : 0;
    lastSimTime = shot.time;

    moveWithVisibleShips(camera, shot, simDt, view.width, view.height);
    if (autoFrame) {
      if (!framed) {
        frame(camera, shot, view.width, view.height, 1);
        framed = true;
      }
      frame(camera, shot, view.width, view.height);
    }
    for (let i = 0; i < shot.impactCount; i++) {
      flashes.add(
        shot.impactX[i]!,
        shot.impactY[i]!,
        shot.impactEnergy[i]!,
        shot.impactKind[i]!,
        shot.impactBody[i]!,
        shot.impactLocalX[i]!,
        shot.impactLocalY[i]!,
      );
    }
    flashes.step(simDt);
    draw(ctx, shot, camera, view.width, view.height, flashes);
  }

  // ---- the fleet ---------------------------------------------------------

  /**
   * What a generation *is*, drawn: every design in it, best first.
   *
   * **This is the view a run is worth watching in, and a battle is not.** A
   * run fights hundreds of times faster than real time, so a window on
   * whichever match is in progress shows a fraction of a second of each and
   * flickers to the next — a picture of nothing, refreshed. What changes at a
   * pace worth watching is the population: a generation of bare cores growing
   * an engine, a wing appearing on one design and then on half of them.
   *
   * Tiles are made once per design and only reordered afterwards, so a
   * generation redraws its hulls when it is bred rather than five times a
   * second for as long as it lasts.
   */
  const showFleet = (index: number, rows: readonly Row[]): void => {
    if (index !== fleetOf) {
      fleetBox.replaceChildren();
      fleetTiles.clear();
      fleetOf = index;
    }
    if (rows.length === 0) {
      if (fleetBox.childElementCount === 0) {
        const note = document.createElement('p');
        note.className = 'none';
        note.textContent = 'Nothing bred yet.';
        fleetBox.append(note);
      }
      return;
    }

    const ranked = [...rows].sort((a, b) => b.fitness - a.fitness);
    const living = new Set(ranked.map((row) => row.id));
    for (const [id, tile] of fleetTiles) {
      if (!living.has(id)) {
        tile.figure.remove();
        fleetTiles.delete(id);
      }
    }

    for (const [rank, row] of ranked.entries()) {
      let tile = fleetTiles.get(row.id);
      if (tile === undefined) {
        tile = makeTile(row);
        fleetTiles.set(row.id, tile);
      }
      // Appending something already here moves it, so this is the reordering.
      fleetBox.append(tile.figure);
      tile.figure.classList.toggle('picked', row.id === picked);
      tile.caption.replaceChildren();
      const name = document.createElement('b');
      name.textContent = `${rank + 1}. #${row.id}`;
      tile.caption.append(
        name,
        ` ${row.matches > 0 ? row.fitness.toFixed(3) : '—'} · ${(row.mass / 1000).toFixed(1)} t`,
      );
      tile.figure.title =
        row.edits.length > 0 ? row.edits.join('\n') : 'a ship the run started from';
    }
  };

  const makeTile = (row: Row): { figure: HTMLElement; caption: HTMLElement } => {
    const figure = document.createElement('figure');
    const canvas = document.createElement('canvas');
    const caption = document.createElement('figcaption');
    figure.append(canvas, caption);
    figure.addEventListener('click', () => {
      picked = row.id;
      editsLine.textContent =
        row.edits.length > 0 ? `#${row.id}: ${row.edits.join('; ')}` : `#${row.id}: a founder`;
      for (const [id, tile] of fleetTiles) tile.figure.classList.toggle('picked', id === picked);
    });
    // Sized and drawn once. The ship is standing still and the tile is a fixed
    // size, so there is nothing to redraw until the design itself changes —
    // and a design never changes, it is replaced by a child.
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(152 * ratio);
    canvas.height = Math.round(96 * ratio);
    const tileCtx = canvas.getContext('2d');
    if (tileCtx !== null) {
      const design = compileBlueprint(row.blueprint);
      const shot = previewSnapshot(design, fleetSnapshot);
      const eye: Camera = { x: 0, y: 0, scale: 1 };
      frame(eye, shot, canvas.width, canvas.height, 1);
      draw(tileCtx, shot, eye, canvas.width, canvas.height);
    }
    return { figure, caption };
  };

  /** Show the ships or a battle, and make the controls match. */
  function applyMode(): void {
    const battle = modeSelect.value === 'battle';
    view.hidden = !battle;
    fleetBox.hidden = battle;
    battleControls.hidden = !battle;
    if (battle) {
      // The canvas measured nothing while it was hidden.
      resize();
      if (replay === null && rollingInput.checked) rollOn();
    } else {
      replay = null;
      replayOf = null;
      watch(null);
    }
  }

  /**
   * Put on the next battle: the newest first, then back through the
   * generation.
   *
   * A run fights faster than anybody can watch, so this is a sample rather
   * than a record — what it is for is seeing *some* whole battles rather than
   * the first tenth of a second of every one of them.
   */
  function rollOn(): void {
    const { rows, matches } = showing();
    if (matches.length === 0) return;
    let at = matches.length > rollingSeen ? matches.length - 1 : rollingAt - 1;
    if (at < 0) at = matches.length - 1;
    rollingAt = at;
    rollingSeen = matches.length;
    startReplay(matches[at]!, rows);
  }

  // ---- reading the run ---------------------------------------------------

  const massOf = (id: number, blueprint: Blueprint): number => {
    let mass = masses.get(id);
    if (mass === undefined) {
      mass = compileBlueprint(blueprint).mass;
      masses.set(id, mass);
    }
    return mass;
  };

  /** Which generation the panel is showing, and the rows and matches in it. */
  const showing = (): { index: number; rows: Row[]; matches: readonly MatchRecord[] } => {
    const empty = { index: 0, rows: [], matches: [] };
    if (run === null) return empty;
    const closed = run.generations.length;
    // The newest generation is the one being fought while there is one, and
    // the last one closed once there is not — a finished run must go on
    // showing what it finished with rather than an empty panel.
    const newest = run.done ? closed - 1 : closed;
    const index = shown < 0 ? newest : Math.min(shown, newest);
    if (index < 0) return empty;
    if (index >= closed) {
      const rows = run.living.individuals.map((individual) => ({
        id: individual.id,
        parent: individual.parent,
        matches: individual.matches,
        fitness: fitness(individual),
        survival: individual.matches > 0 ? individual.survival / individual.matches : 0,
        damage: individual.matches > 0 ? individual.damage / individual.matches : 0,
        race: individual.matches > 0 ? individual.race / individual.matches : 0,
        mass: massOf(individual.id, individual.blueprint),
        edits: individual.edits,
        blueprint: individual.blueprint,
      }));
      return { index, rows, matches: run.played };
    }
    const record = run.generations[index]!;
    const rows = record.individuals.map((individual) => ({
      id: individual.id,
      parent: individual.parent,
      matches: individual.matches,
      fitness: individual.fitness,
      survival: individual.survival,
      damage: individual.damage,
      race: individual.race,
      mass: individual.mass,
      edits: individual.edits,
      blueprint: parseBlueprint(individual.blueprint),
    }));
    return { index, rows, matches: record.matches };
  };

  const startReplay = (record: MatchRecord, rows: readonly Row[]): void => {
    const entrants: Blueprint[] = [];
    for (const id of record.competitors) {
      const row = rows.find((candidate) => candidate.id === id);
      if (row !== undefined) entrants.push(row.blueprint);
    }
    if (entrants.length < 2 || run === null) return;
    replay = new Match(entrants, { ...run.config.match, seed: record.seed });
    replayOf = record;
    replayPlaying = true;
    playButton.textContent = 'Pause';
    // Asked for a battle, so show one: a match clicked in the list is the
    // whole reason the viewer is there.
    modeSelect.value = 'battle';
    applyMode();
  };

  const refresh = (): void => {
    const { index, rows, matches } = showing();
    if (modeSelect.value !== 'battle') showFleet(index, rows);

    // The list of generations to choose from, rebuilt only when it grows.
    const count = (run?.generations.length ?? 0) + (run !== null && !run.done ? 1 : 0);
    if (generationSelect.options.length !== count) {
      generationSelect.replaceChildren();
      for (let g = 0; g < count; g++) {
        const option = document.createElement('option');
        option.value = String(g);
        const fighting = run !== null && !run.done && g === run.generations.length;
        option.textContent = fighting ? `${g + 1} (fighting)` : String(g + 1);
        generationSelect.append(option);
      }
      generationSelect.value = String(shown < 0 ? Math.max(0, count - 1) : shown);
    }
    shownGeneration.textContent = run === null ? '—' : String(index + 1);

    const ranked = [...rows].sort((a, b) => b.fitness - a.fitness);
    const best = ranked[0];
    shipsBody.replaceChildren();
    for (const row of ranked) {
      const tr = document.createElement('tr');
      if (row === best) tr.className = 'champion';
      for (const cell of [
        String(row.id),
        row.parent < 0 ? '—' : String(row.parent),
        row.fitness.toFixed(3),
        row.survival.toFixed(2),
        row.damage.toFixed(2),
        row.race.toFixed(2),
        (row.mass / 1000).toFixed(1),
      ]) {
        const td = document.createElement('td');
        td.textContent = cell;
        tr.append(td);
      }
      tr.title = row.edits.length > 0 ? row.edits.join('\n') : 'a ship the run started from';
      tr.addEventListener('click', () => {
        editsLine.textContent =
          row.edits.length > 0 ? `#${row.id}: ${row.edits.join('; ')}` : `#${row.id}: a founder`;
      });
      shipsBody.append(tr);
    }

    matchesBody.replaceChildren();
    for (const [i, record] of matches.entries()) {
      const tr = document.createElement('tr');
      if (record === replayOf) tr.className = 'watched';
      for (const cell of [
        String(i + 1),
        record.competitors.join(' '),
        record.ending,
        record.elapsed.toFixed(0),
      ]) {
        const td = document.createElement('td');
        td.textContent = cell;
        tr.append(td);
      }
      tr.addEventListener('click', () => startReplay(record, rows));
      matchesBody.append(tr);
    }

    const series: Series[] = [];
    const closed = run === null ? [] : run.generations;
    if (closed.length > 0) {
      const of = (read: (g: GenerationRecord) => number): number[] => closed.map(read);
      series.push(
        { name: 'best', colour: '#e6edf5', values: of((g) => g.bestFitness) },
        { name: 'mean', colour: '#7fa8e0', values: of((g) => g.meanFitness) },
        { name: 'surviving', colour: '#7fd6a0', values: of((g) => g.mean.survival), dashed: true },
        { name: 'damage', colour: '#e0655f', values: of((g) => g.mean.damage), dashed: true },
        { name: 'ground', colour: '#e9c05f', values: of((g) => g.mean.race), dashed: true },
      );
    }
    // The yardstick last, so it is drawn over the rest: it is the line that
    // means the same thing at both ends of the chart, and the others are not.
    const points = yardstick?.points ?? measured?.points;
    if (points !== undefined && points.length > 0) {
      const scores: number[] = [];
      for (const point of points) scores[point.generation] = point.mean;
      series.push({ name: 'vs. yardstick', colour: '#5bd6d6', values: scores });
    }
    drawChart(chartCtx, series, chart.width, chart.height, window.devicePixelRatio || 1);

    const top = run === null ? null : finalist(run.record());
    saveButton.disabled = top === null;
    exportButton.disabled = top === null;
    measureButton.disabled = top === null || yardstick !== null;
    championLine.textContent =
      top === null
        ? '—'
        : `#${top.individual.id}, best of generation ${top.generation + 1}: ` +
          `${top.individual.fitness.toFixed(3)} over ${top.individual.matches} matches, ` +
          `${(top.individual.mass / 1000).toFixed(1)} t`;
  };

  const bestBlueprint = (): { blueprint: Blueprint; generation: number } | null => {
    if (run === null) return null;
    const top = finalist(run.record());
    if (top === null) return null;
    const blueprint = parseBlueprint(top.individual.blueprint);
    return {
      blueprint: { ...blueprint, name: `${blueprint.name} g${top.generation + 1}` },
      generation: top.generation,
    };
  };

  saveButton.addEventListener('click', () => {
    const best = bestBlueprint();
    if (best === null) return;
    library.save(best.blueprint);
    championLine.textContent = `saved as "${best.blueprint.name}" — open it in the ship editor`;
  });
  exportButton.addEventListener('click', () => {
    const best = bestBlueprint();
    if (best === null) return;
    download(`${best.blueprint.name.replace(/[^\w.-]+/g, '_')}.json`, toFileText(best.blueprint));
  });
  measureButton.addEventListener('click', () => {
    if (run === null || run.generations.length === 0) return;
    const record = run.record();
    const chosen = benchmarkSelect.value;
    const benchmark = chosen === OWN_FINAL ? latest(record) : library.load(chosen);
    if (benchmark === null) {
      yardstickLine.textContent = 'Nothing to measure against yet.';
      return;
    }
    // The record rather than a copy of it, so a measurement started while a
    // run is still going carries on into the generations it has not closed
    // yet — the answer is per generation either way.
    yardstick = new Yardstick(record, benchmark);
    measured = null;
    measureButton.disabled = true;
    yardstickLine.textContent = `Measuring against ${benchmark.name}…`;
  });

  generationSelect.addEventListener('change', () => {
    const picked = Number(generationSelect.value);
    // Picking the generation being fought means "keep up with it".
    shown = run !== null && picked >= run.generations.length ? -1 : picked;
    refresh();
  });

  // ---- driving the run ---------------------------------------------------

  const setPaused = (next: boolean): void => {
    paused = next;
    pauseButton.textContent = paused ? 'Resume' : 'Pause';
  };

  startButton.addEventListener('click', () => {
    const founders: Blueprint[] = [];
    for (const option of foundersSelect.selectedOptions) {
      const blueprint = library.load(option.value);
      if (blueprint !== null) founders.push(blueprint);
    }
    if (founders.length === 0) {
      readout.textContent = 'Pick at least one ship to start from.';
      readout.className = 'warn';
      return;
    }
    readout.className = '';
    run = new Run(founders, readSetup().config);
    yardstick = null;
    measured = null;
    yardstickLine.textContent = 'Measure once there is something to measure.';
    masses.clear();
    shown = -1;
    replay = null;
    replayOf = null;
    editsLine.textContent = '';
    generationSelect.replaceChildren();
    watch(null);
    fleetOf = -1;
    setPaused(false);
    pauseButton.disabled = false;
    stopButton.disabled = false;
    refresh();
  });
  pauseButton.addEventListener('click', () => setPaused(!paused));
  stopButton.addEventListener('click', () => {
    if (run !== null && !run.done) {
      // Stopping keeps what was fought: the generations already closed are a
      // run, and the one in progress was never going to be comparable to them.
      setPaused(true);
    }
    stopButton.disabled = true;
  });

  modeSelect.addEventListener('change', () => {
    applyMode();
    refresh();
  });
  rollingInput.addEventListener('change', () => {
    if (rollingInput.checked && (replay === null || replay.done)) rollOn();
  });

  window.addEventListener('resize', resize);
  resize();
  applyMode();
  refresh();

  const tick = (now: number): void => {
    if (last === 0) last = now;
    const elapsed = Math.min((now - last) / 1000, 0.25);
    last = now;

    if (run !== null && !run.done && !paused) {
      const budget = Math.max(1, Math.min(200, number(inputs.effort, 12)));
      const until = now + budget;
      // In slices, so a single long match cannot hold the frame: `advance`
      // stops on a step count, and the clock decides how many of those fit.
      while (performance.now() < until && run.advance(240)) {
        // Fighting.
      }
    }

    if (yardstick !== null) {
      // Its own slice rather than a share of the run's, so measuring while a
      // run is going slows the frame rather than the run — which is the right
      // way round: the run is the thing that must not be held up.
      const budget = Math.max(1, Math.min(200, number(inputs.effort, 12)));
      const until = performance.now() + budget;
      while (performance.now() < until && yardstick.advance(240)) {
        // Measuring.
      }
      if (yardstick.done) {
        measured = yardstick.report();
        yardstick = null;
        // Said before the button comes back, not on the next sample: a button
        // offering another measurement beside a line still saying "measuring"
        // is the page contradicting itself, however briefly.
        reportYardstick();
        measureButton.disabled = false;
      }
    }

    if (replay !== null && replay.done && replayPlaying && rollingInput.checked) {
      rollOn();
    }

    if (replay !== null && replayPlaying && !replay.done) {
      const speed = Number(speedSelect.value);
      accumulator += elapsed * speed;
      let steps = 0;
      const dt = run?.config.match.dt ?? DEFAULT_MATCH.dt;
      while (accumulator >= dt && steps < MAX_STEPS_PER_FRAME && !replay.done) {
        replay.advance();
        accumulator -= dt;
        steps++;
      }
      if (steps === MAX_STEPS_PER_FRAME) accumulator = 0;
    }

    watch(replay);
    playButton.disabled = replay === null;
    stepButton.disabled = replay === null;
    if (modeSelect.value === 'battle') paint();

    // Sampled rather than redrawn every frame: the panel is a page of DOM and
    // the run is the thing the frame is for (DESIGN.md non-negotiable 5).
    if (now - refreshedAt > 200) {
      refreshedAt = now;
      refresh();
      report();
    }

    window.requestAnimationFrame(tick);
  };

  /** What a measurement says, once there is one. */
  function reportYardstick(): void {
    const points = yardstick?.points ?? measured?.points;
    if (points === undefined || points.length === 0) return;
    const first = points[0]!;
    const last = points[points.length - 1]!;
    const gain = last.mean - first.mean;
    const where = yardstick === null ? '' : ` · measuring, ${(yardstick.progress * 100).toFixed(0)}%`;
    yardstickLine.textContent =
      `generation ${first.generation + 1} scored ${first.mean.toFixed(3)}, ` +
      `generation ${last.generation + 1} scored ${last.mean.toFixed(3)} ` +
      `(${gain >= 0 ? '+' : ''}${gain.toFixed(3)}) · ` +
      `${last.wins} of ${last.individuals} beat it${where}`;
  }

  function report(): void {
    reportYardstick();
    if (run === null) {
      stateLabel.textContent = 'idle';
      barFill.style.width = '0';
      return;
    }
    const done = run.generations.length;
    const total = run.config.generations;
    stateLabel.textContent = run.done ? 'finished' : paused ? 'paused' : 'running';
    pauseButton.disabled = run.done;
    barFill.style.width = `${(run.progress * 100).toFixed(1)}%`;
    let fought = 0;
    for (const generation of run.generations) fought += generation.matches.length;
    fought += run.done ? 0 : run.played.length;
    readout.textContent =
      `generation ${Math.min(done + 1, total)} of ${total} · ` +
      `${fought} matches fought · ${(run.progress * 100).toFixed(0)}%`;
    if (modeSelect.value !== 'battle') {
      const shown = showing();
      watchingLabel.textContent = `${shown.rows.length} ships of generation ${shown.index + 1}`;
    } else if (replay !== null) {
      watchingLabel.textContent =
        `${(replayOf?.competitors ?? []).join(' v ')} · ${(replay.progress * 100).toFixed(0)}%` +
        `${replay.done ? ' · over' : ''}`;
    } else {
      watchingLabel.textContent = 'pick a match from the list';
    }
  }

  window.requestAnimationFrame(tick);
}
