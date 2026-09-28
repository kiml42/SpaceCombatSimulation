import {
  capture,
  compileBlueprint,
  expandFleet,
  serialiseFleet,
  shipFleet,
  Snapshot,
  type Fleet,
  type ShipDesign,
} from '../sim/index.js';
import { Flashes } from '../render/flashes.js';
import { draw } from '../render/canvas2d.js';
import { drawChart, indexAt, xOf, type ChartLayout, type Series } from '../render/chart.js';
import {
  easeScale,
  fitScale,
  frame,
  moveWithVisibleShips,
  type Camera,
} from '../render/camera.js';
import { BUILT_IN, FLEET_FILES, Library, toFileText } from '../editor/library.js';
import { NO_TEAM } from '../editor/preview.js';
import { fleetSnapshot } from '../editor/fleetPreview.js';
import type { FleetView } from '../editor/fleetDocument.js';
import { fitness } from '../evolution/generation.js';
import { DEFAULT_MATCH, isFleet, Match, type Entrant, type MatchConfig } from '../evolution/match.js';
import { DEFAULT_FLEET_LIMITS } from '../evolution/fleetMutate.js';
import { DEFAULT_KINDS, type KindWeights } from '../evolution/mutate.js';
import { parseRunConfig, serialiseRunConfig, type RunSetup } from '../evolution/configFile.js';
import { latest, Yardstick, type YardstickReport } from '../evolution/yardstick.js';
import {
  finalist,
  DEFAULT_RUN,
  Run,
  type GenerationRecord,
  entrantOf,
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

/**
 * Compiled designs kept for the panel: a few generations of a large
 * population, which is what seeking back and forth actually revisits.
 */
const DESIGNS_KEPT = 512;

/** Cap on replay steps per frame, so a tab left in the background cannot catch up in one lurch. */
const MAX_STEPS_PER_FRAME = 16;

/** A fleet tile's size, CSS pixels. */
const TILE_WIDTH = 152;
const TILE_HEIGHT = 96;
/** How much of the way the fleet's scale closes on its target each frame. */
const FLEET_EASE = 0.15;

/** What the settings are saved under, so a refresh does not cost them. */
const SETUP_KEY = 'scs2d.evolution.setup';

const FIELDS = [
  'generations',
  'population',
  'winners',
  'group',
  'minMatches',
  'massBudget',
  'fleetRadius',
  'fleetShips',
  'seed',
  'duration',
  'radius',
  'scatter',
  'survivalWeight',
  'functionalWeight',
  'damageWeight',
  'disablingWeight',
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
  readonly functional: number;
  readonly damage: number;
  readonly disabling: number;
  readonly race: number;
  readonly mass: number;
  readonly edits: readonly string[];
  readonly entrant: Entrant;
}

/** An individual laid out to draw — a ship as a fleet of one — and what it weighs. */
interface Picture {
  readonly view: Pick<FleetView, 'ships' | 'designs'>;
  readonly mass: number;
}

/** A design's tile in the population, and the scale it was last drawn at. */
interface Tile {
  readonly figure: HTMLElement;
  readonly caption: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly picture: Picture;
  drawnAt: number;
}

/** A founder or benchmark in a list, as its option's value: `ship:Name` or `fleet:Name`. */
type Choice = { kind: 'ship' | 'fleet'; name: string };
const valueOf = (kind: Choice['kind'], name: string): string => `${kind}:${name}`;
function pickOf(value: string): Choice {
  // Settings saved before fleets could found a run hold bare ship names.
  if (value.startsWith('fleet:')) return { kind: 'fleet', name: value.slice(6) };
  return { kind: 'ship', name: value.startsWith('ship:') ? value.slice(5) : value };
}

function fleetFileText(fleet: Fleet): string {
  return `${JSON.stringify(serialiseFleet(fleet), null, 2)}\n`;
}

function ratio(): number {
  return window.devicePixelRatio || 1;
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
  const chartTip = el<HTMLElement>('chartTip');
  const legend = el<HTMLElement>('legend');

  const startButton = el<HTMLButtonElement>('start');
  const pauseButton = el<HTMLButtonElement>('pause');
  const stopButton = el<HTMLButtonElement>('stop');
  const stateLabel = el<HTMLElement>('state');
  const readout = el<HTMLElement>('readout');
  const barFill = el<HTMLElement>('barFill');
  const foundersSelect = el<HTMLSelectElement>('founders');
  const goalInput = el<HTMLSelectElement>('goal');
  const playButton = el<HTMLButtonElement>('play');
  const stepButton = el<HTMLButtonElement>('step');
  const skipButton = el<HTMLButtonElement>('skip');
  const fitButton = el<HTMLButtonElement>('fit');
  const speedSelect = el<HTMLSelectElement>('speed');
  const modeSelect = el<HTMLSelectElement>('mode');
  const battleControls = el<HTMLElement>('battleControls');
  const fleetBox = el<HTMLElement>('fleet');
  const watchingLabel = el<HTMLElement>('watching');
  const latestButton = el<HTMLButtonElement>('latest');
  const shownGeneration = el<HTMLElement>('shownGeneration');
  const fightingLabel = el<HTMLElement>('fighting');
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
  const fleetLibrary = new Library(window.localStorage, FLEET_FILES);
  const load = (value: string): Entrant | null => {
    const { kind, name } = pickOf(value);
    return kind === 'fleet' ? fleetLibrary.load(name) : library.load(name);
  };
  const chosenFounders = (): Entrant[] => {
    const founders: Entrant[] = [];
    for (const option of foundersSelect.selectedOptions) {
      try {
        const founder = load(option.value);
        if (founder !== null) founders.push(founder);
      } catch {
        // An unreadable saved file is left out, as a missing one is.
      }
    }
    return founders;
  };

  let run: Run | null = null;
  /** Before a run: the founders as chosen, and the first match they would fight, paused at its start. */
  let previewRows: Row[] = [];
  let previewMatch: Match | null = null;
  /** What saving the best said, and which individual it was. */
  let savedAs: { id: number; text: string } | null = null;
  let paused = false;
  let replay: Match | null = null;
  let replayOf: MatchRecord | null = null;
  let replayPlaying = true;
  /**
   * Whether the match being watched has been given up on, and the next one
   * the run finishes should go on in its place.
   */
  let skipping = false;
  let watchedMatch: Match | null = null;
  // Which generation the results panel is showing, or -1 to follow the newest.
  let shown = -1;
  let yardstick: Yardstick | null = null;
  let measured: YardstickReport | null = null;
  /**
   * The tiles, by ship rather than by generation: a design carried over into
   * the next generation keeps its tile, which is what makes seeking across a
   * run redraw only what actually changed.
   */
  const fleetTiles = new Map<number, Tile>();
  const tileSnapshot = new Snapshot();
  /**
   * Pixels per metre, shared by every tile so their sizes compare. It eases
   * towards whatever fits the largest ship on show, so seeking through a run
   * shows the ships growing rather than each tile refitting to its own.
   */
  let fleetScale = 0;
  let fleetTarget = 0;
  let picked = -1;
  /** Where the chart drew itself, and which point the pointer is over. */
  let chartLayout: ChartLayout = { x: 0, y: 0, width: 0, height: 0, count: 0 };
  let chartSeries: Series[] = [];
  let hoverAt: number | null = null;
  /** Whether a drag across the chart is seeking through the generations. */
  let seeking = false;
  /** A selection made since the panel was last rebuilt. */
  let reselected = false;
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
  const pictures = new Map<number, Picture>();
  let refreshedAt = 0;

  // ---- settings ----------------------------------------------------------

  const defaults: Record<(typeof FIELDS)[number], string> = {
    generations: String(DEFAULT_RUN.generations),
    population: String(DEFAULT_RUN.population),
    winners: String(DEFAULT_RUN.winners),
    group: String(DEFAULT_RUN.group),
    minMatches: String(DEFAULT_RUN.minMatches),
    massBudget: '',
    fleetRadius: String(DEFAULT_FLEET_LIMITS.radius),
    fleetShips: String(DEFAULT_FLEET_LIMITS.maxShips),
    seed: String(DEFAULT_RUN.seed),
    duration: String(DEFAULT_MATCH.duration),
    radius: String(DEFAULT_MATCH.radius),
    scatter: String(Math.round((DEFAULT_MATCH.scatter * 180) / Math.PI)),
    survivalWeight: String(DEFAULT_MATCH.weights.survival),
    functionalWeight: String(DEFAULT_MATCH.weights.functional),
    damageWeight: String(DEFAULT_MATCH.weights.damage),
    disablingWeight: String(DEFAULT_MATCH.weights.disabling),
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

  /**
   * Show what Start would begin with. Only while there is no run: once one
   * has been fought, its results are what the panel is for.
   */
  const refreshPreview = (): void => {
    if (run !== null) return;
    for (const id of [...pictures.keys()]) if (id < 0) pictures.delete(id);
    for (const [id, tile] of [...fleetTiles]) {
      if (id >= 0) continue;
      tile.figure.remove();
      fleetTiles.delete(id);
    }
    const founders = chosenFounders();
    previewRows = founders.map((entrant, k) => ({
      id: -(k + 1),
      parent: -1,
      matches: 0,
      fitness: 0,
      survival: 0,
      functional: 0,
      damage: 0,
      disabling: 0,
      race: 0,
      mass: pictureOf(-(k + 1), entrant).mass,
      edits: [],
      entrant,
    }));
    try {
      previewMatch = founders.length === 0 ? null : new Run(founders, readSetup().config).unmutatedOpening();
    } catch {
      // A founder that will not compile has nothing to show.
      previewMatch = null;
    }
    refresh();
  };

  const saveSetup = (): void => {
    const held: Record<string, string> = { goal: goalInput.value };
    for (const name of FIELDS) held[name] = inputs[name].value;
    held['founders'] = [...foundersSelect.selectedOptions].map((o) => o.value).join('\n');
    try {
      window.localStorage.setItem(SETUP_KEY, JSON.stringify(held));
    } catch {
      // Storage being full or refused costs the settings, not the run.
    }
    refreshPreview();
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
  // Settings saved when this was a checkbox held '1' or ''.
  const heldGoal = held['goal'] === '' ? 'none' : held['goal'] === '1' ? 'solid' : held['goal'];
  goalInput.value = heldGoal === 'ghost' || heldGoal === 'none' ? heldGoal : 'solid';

  const wanted = new Set((held['founders'] ?? 'Corvette').split('\n').map((value) => {
    const { kind, name } = pickOf(value);
    return valueOf(kind, name);
  }));
  // Chosen by name, and a name opens one layout: the player's copy where there
  // is one. The editors list a shadowed shipped one beside it because that is
  // something to open; a founder picked by name is not.
  const stockShips = new Set(BUILT_IN.map((blueprint) => blueprint.name));
  const stockFleets = new Set(FLEET_FILES.builtIn.map((fleet) => fleet.name));
  const fillList = (select: HTMLSelectElement, label: (stock: boolean, name: string) => string): void => {
    for (const [kind, title, entries, stock] of [
      ['ship', 'Ships', library.list(), stockShips],
      ['fleet', 'Fleets', fleetLibrary.list(), stockFleets],
    ] as const) {
      const group = document.createElement('optgroup');
      group.label = title;
      for (const entry of entries) {
        if (entry.stock && entry.saved) continue;
        const option = new Option(label(stock.has(entry.name), entry.name), valueOf(kind, entry.name));
        group.append(option);
      }
      select.append(group);
    }
  };
  fillList(foundersSelect, (stock, name) => (stock ? name : `${name} (saved)`));
  for (const option of foundersSelect.options) option.selected = wanted.has(option.value);
  if (foundersSelect.selectedOptions.length === 0 && foundersSelect.options.length > 0) {
    foundersSelect.options[0]!.selected = true;
  }

  const OWN_FINAL = '';
  benchmarkSelect.append(new Option('its own final design', OWN_FINAL));
  fillList(benchmarkSelect, (_, name) => name);

  /** Whether a fleet is among the founders, which makes it a run of fleets. */
  const fleetRun = (): boolean => [...foundersSelect.selectedOptions].some((o) => pickOf(o.value).kind === 'fleet');
  const fleetSettings = el<HTMLElement>('fleetSettings');
  const showFleetSettings = (): void => {
    fleetSettings.hidden = !fleetRun();
  };
  showFleetSettings();
  foundersSelect.addEventListener('change', showFleetSettings);

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
      group: Math.max(1, Math.round(number(inputs.group, DEFAULT_RUN.group))),
      minMatches: Math.max(1, Math.round(number(inputs.minMatches, DEFAULT_RUN.minMatches))),
      massBudget: tonnes > 0 ? tonnes * 1000 : Infinity,
      fleet: {
        radius: Math.max(1, number(inputs.fleetRadius, DEFAULT_FLEET_LIMITS.radius)),
        maxShips: Math.max(1, Math.round(number(inputs.fleetShips, DEFAULT_FLEET_LIMITS.maxShips))),
      },
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
        goal:
          goalInput.value === 'none' || DEFAULT_MATCH.goal === null
            ? null
            : { ...DEFAULT_MATCH.goal, solid: goalInput.value !== 'ghost' },
        weights: {
          survival: number(inputs.survivalWeight, 1),
          functional: number(inputs.functionalWeight, 1),
          damage: number(inputs.damageWeight, 1),
          disabling: number(inputs.disablingWeight, 1),
          race: number(inputs.raceWeight, 1),
        },
      },
    };
  };

  /** Everything the form says, as a run's settings. */
  const readSetup = (): RunSetup => {
    const picked = [...foundersSelect.selectedOptions].map((option) => pickOf(option.value));
    return {
      founders: picked.filter((p) => p.kind === 'ship').map((p) => p.name),
      fleets: picked.filter((p) => p.kind === 'fleet').map((p) => p.name),
      config: { ...DEFAULT_RUN, ...configure() },
    };
  };

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
    inputs.fleetRadius.value = String(config.fleet.radius ?? DEFAULT_FLEET_LIMITS.radius);
    inputs.fleetShips.value = String(config.fleet.maxShips ?? DEFAULT_FLEET_LIMITS.maxShips);
    inputs.duration.value = String(match.duration);
    inputs.radius.value = String(match.radius);
    inputs.scatter.value = String((match.scatter * 180) / Math.PI);
    inputs.survivalWeight.value = String(match.weights.survival);
    inputs.functionalWeight.value = String(match.weights.functional);
    inputs.damageWeight.value = String(match.weights.damage);
    inputs.disablingWeight.value = String(match.weights.disabling);
    inputs.raceWeight.value = String(match.weights.race);
    inputs.kindThruster.value = String(kinds.thruster);
    inputs.kindStructure.value = String(kinds.structure);
    inputs.kindTurret.value = String(kinds.turret);
    inputs.kindBeamTurret.value = String(kinds.beamTurret);
    inputs.kindHullGun.value = String(kinds.hullGun);
    inputs.kindHullBeam.value = String(kinds.hullBeam);
    inputs.kindCore.value = String(kinds.core);
    goalInput.value = match.goal === null ? 'none' : match.goal.solid === false ? 'ghost' : 'solid';
    const fleets = setup.fleets ?? [];
    if (setup.founders.length + fleets.length > 0) {
      const named = new Set([
        ...setup.founders.map((name) => valueOf('ship', name)),
        ...fleets.map((name) => valueOf('fleet', name)),
      ]);
      for (const option of foundersSelect.options) option.selected = named.has(option.value);
    }
    showFleetSettings();
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
    paintChart();
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

  const togglePlay = (): void => {
    replayPlaying = !replayPlaying;
    playButton.textContent = replayPlaying ? 'Pause' : 'Play';
    last = 0;
  };

  const stepOnce = (): void => {
    replayPlaying = false;
    playButton.textContent = 'Play';
    if (replay !== null && !replay.done) replay.advance();
  };

  fitButton.addEventListener('click', () => {
    autoFrame = true;
  });
  playButton.addEventListener('click', togglePlay);
  stepButton.addEventListener('click', stepOnce);

  /**
   * Give up on the match being watched and put another on.
   *
   * Plenty of matches are nothing to watch — early on, two ships that cannot
   * steer drifting apart until the clock runs out — and without this the only
   * way past one is to sit through it at whatever speed the viewer allows.
   * Skip takes the next match of the generation on show; if the run has not
   * fought one yet, it waits and takes whatever the run finishes next, rather
   * than holding on a battle already given up on.
   */
  const skipMatch = (): void => {
    if (run === null) return;
    const { rows, matches } = showing();
    const at = replayOf === null ? -1 : matches.indexOf(replayOf);
    // Round the list when there will be no later match: a finished or
    // paused run is a fixed set to look through rather than a stream.
    const next = matches[at + 1] ?? (run.done || paused ? matches[0] : undefined);
    if (next !== undefined && next !== replayOf) {
      startReplay(next, rows);
      return;
    }
    skipping = true;
    replayPlaying = true;
    playButton.textContent = 'Pause';
  };

  skipButton.addEventListener('click', skipMatch);

  /**
   * The viewer's keys, on the battle this page shows: space to pause, full
   * stop to single-step, F to re-fit, N for another match.
   *
   * Only while a battle is on show and nothing is being typed into — the page
   * is mostly a form, and a run's settings are numbers with full stops in
   * them.
   */
  window.addEventListener('keydown', (event) => {
    if (modeSelect.value !== 'battle') return;
    const active = document.activeElement;
    if (
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement ||
      active instanceof HTMLSelectElement
    ) {
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === ' ') {
      // Also stops a focused button being pressed by the same key, which
      // would undo the toggle this is making.
      event.preventDefault();
      togglePlay();
    } else if (event.key === '.') {
      stepOnce();
    } else if (event.key === 'f' || event.key === 'F') {
      autoFrame = true;
    } else if (event.key === 'n' || event.key === 'N') {
      if (!skipButton.disabled) skipMatch();
    }
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

  // ---- the chart ---------------------------------------------------------

  /**
   * Draw the chart, marking what is under the pointer and what is selected.
   *
   * Kept apart from `refresh` so a pointer moving over it redraws at once
   * rather than at the next telemetry sample: a mark that lags the cursor by
   * a fifth of a second reads as the chart being broken.
   */
  function paintChart(): void {
    chartLayout = drawChart(
      chartCtx,
      chartSeries,
      chart.width,
      chart.height,
      window.devicePixelRatio || 1,
      { hover: hoverAt ?? undefined, picked: markedGeneration() },
    );
  }

  /**
   * The generation the panel is showing, when the chart has a point for it.
   *
   * Nothing is marked while the generation being fought is the one on show:
   * it has no point yet, and marking the one before it would say the chart
   * and the panel disagree when they do not.
   */
  function markedGeneration(): number | undefined {
    if (run === null) return undefined;
    const closed = run.generations.length;
    const newest = run.done ? closed - 1 : closed;
    const index = shown < 0 ? newest : Math.min(shown, newest);
    return index >= 0 && index < closed ? index : undefined;
  }

  /**
   * What the legend says: the names of the lines, and — while a generation is
   * under the pointer — what each of them was worth there.
   *
   * On the legend rather than in the tooltip because the colours are already
   * there: a floating box repeating five labelled colours beside five
   * labelled colours is two things to read where there was one.
   */
  function showLegend(): void {
    legend.replaceChildren();
    for (const line of chartSeries) {
      const entry = document.createElement('span');
      entry.style.color = line.colour;
      entry.textContent = line.name;
      const value = hoverAt === null ? undefined : line.values[hoverAt];
      if (value !== undefined && Number.isFinite(value)) {
        const reading = document.createElement('b');
        reading.textContent = value.toFixed(3);
        entry.append(reading);
      }
      legend.append(entry);
    }
  }

  /** Which generation the pointer is over, as an index, or null. */
  const chartPointAt = (event: PointerEvent | MouseEvent, clamp = false): number | null => {
    const rect = chart.getBoundingClientRect();
    return indexAt(chartLayout, event.clientX - rect.left, clamp);
  };

  const hoverChart = (at: number | null): void => {
    if (at === hoverAt) return;
    hoverAt = at;
    chartTip.hidden = at === null;
    if (at !== null) {
      chartTip.textContent = `generation ${at + 1}`;
      chartTip.style.left = `${xOf(chartLayout, at)}px`;
    }
    paintChart();
    showLegend();
  };

  /**
   * Go to a generation, as the picker does.
   *
   * The same selection, so the table, the matches and the ships all follow —
   * the chart is another way in to it rather than a second idea of which
   * generation is being looked at. Marked rather than done: while seeking,
   * the pointer moves faster than the panel can be rebuilt, and rebuilding it
   * per *event* rather than per frame would spend the drag redrawing
   * generations nobody saw.
   */
  const goTo = (at: number): void => {
    if (at === shown) return;
    shown = at;
    reselected = true;
  };

  chart.addEventListener('pointermove', (event) => {
    const at = chartPointAt(event, seeking);
    hoverChart(at);
    if (seeking && at !== null) goTo(at);
  });
  chart.addEventListener('pointerleave', () => {
    if (!seeking) hoverChart(null);
  });
  chart.addEventListener('pointerdown', (event) => {
    const at = chartPointAt(event, true);
    if (at === null) return;
    // Captured, so a drag that runs off the end of the plot goes on seeking
    // to the end of the run rather than stopping where the canvas does.
    chart.setPointerCapture(event.pointerId);
    seeking = true;
    goTo(at);
  });
  const stopSeeking = (event: PointerEvent): void => {
    if (!seeking) return;
    seeking = false;
    if (chart.hasPointerCapture(event.pointerId)) chart.releasePointerCapture(event.pointerId);
  };
  chart.addEventListener('pointerup', stopSeeking);
  chart.addEventListener('pointercancel', stopSeeking);

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
   * Tiles are made once per design and only reordered afterwards, and
   * redrawn only while the shared scale is easing, so a generation redraws
   * its hulls when it is bred rather than five times a second for as long as
   * it lasts.
   */
  const showFleet = (rows: readonly Row[]): void => {
    const empty = fleetBox.querySelector('p.none');
    if (rows.length === 0) {
      for (const tile of fleetTiles.values()) tile.figure.remove();
      fleetTiles.clear();
      const text = run === null ? 'Pick founders to see them here.' : 'Nothing bred yet.';
      if (empty === null) {
        const note = document.createElement('p');
        note.className = 'none';
        note.textContent = text;
        fleetBox.append(note);
      } else empty.textContent = text;
      return;
    }
    empty?.remove();

    fleetTarget = Infinity;
    for (const row of rows) {
      const shot = fleetSnapshot(pictureOf(row.id, row.entrant).view, tileSnapshot, NO_TEAM);
      fleetTarget = Math.min(fleetTarget, fitScale(shot, TILE_WIDTH * ratio(), TILE_HEIGHT * ratio()));
    }
    if (fleetScale === 0) fleetScale = fleetTarget;

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
      // A preview's founders have no id yet; their names say more.
      name.textContent = row.id < 0 ? row.entrant.name : `${rank + 1}. #${row.id}`;
      const ships = tile.picture.view.ships.length;
      const weight = document.createElement('span');
      weight.textContent =
        `${(row.mass / 1000).toFixed(1)} t` + (isFleet(row.entrant) ? ` · ${ships} ship${ships === 1 ? '' : 's'}` : '');
      tile.caption.append(name, row.id < 0 ? '' : ` ${row.matches > 0 ? row.fitness.toFixed(3) : '—'}`, weight);
      tile.figure.title = row.edits.length > 0 ? row.edits.join('\n') : 'a founder of the run';
    }
  };

  const makeTile = (row: Row): Tile => {
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
    canvas.width = Math.round(TILE_WIDTH * ratio());
    canvas.height = Math.round(TILE_HEIGHT * ratio());
    const tile: Tile = { figure, caption, canvas, picture: pictureOf(row.id, row.entrant), drawnAt: 0 };
    drawTile(tile);
    return tile;
  };

  /**
   * Draw a tile at the fleet's scale, centred on its own ship. Only when that
   * scale has moved since it was last drawn: a design never changes, it is
   * replaced by a child.
   */
  const drawTile = (tile: Tile): void => {
    if (tile.drawnAt === fleetScale) return;
    const tileCtx = tile.canvas.getContext('2d');
    if (tileCtx === null) return;
    const shot = fleetSnapshot(tile.picture.view, tileSnapshot, NO_TEAM);
    const eye: Camera = {
      x: (shot.minX + shot.maxX) / 2,
      y: (shot.minY + shot.maxY) / 2,
      scale: fleetScale,
    };
    draw(tileCtx, shot, eye, tile.canvas.width, tile.canvas.height);
    tile.drawnAt = fleetScale;
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
      if (replay === null) rollOn();
    } else {
      replay = null;
      replayOf = null;
      watch(null);
    }
  }

  /**
   * Put on the most recently finished match of the run, whichever generation
   * is on show — or hold on the one just watched if nothing has finished since.
   *
   * A run fights faster than anybody can watch, so this is a sample rather
   * than a record: whole battles, each the latest there is when the one before
   * it ends. Pausing or switching to the ships stops it; clicking a match
   * watches that one, and the newest follows it.
   */
  function rollOn(): void {
    if (run === null) return;
    // The generation being fought has none yet just after it opens, so the
    // newest may be the last of the one before it.
    let latest = showing(-1);
    if (latest.matches.length === 0 && latest.index > 0) latest = showing(latest.index - 1);
    const newest = latest.matches[latest.matches.length - 1];
    if (newest === undefined || newest === replayOf) return;
    startReplay(newest, latest.rows);
  }

  // ---- reading the run ---------------------------------------------------

  /**
   * A design, compiled once.
   *
   * An individual's id never repeats and its layout never changes — a design
   * is replaced by a child rather than edited — so one compile serves the mass
   * in the table and the picture in its tile, however many times a run is
   * seeked back and forth across.
   *
   * **Capped, because a run is longer than memory is.** Seeking across a
   * thousand generations of twelve would otherwise hold twelve thousand
   * compiled designs, each with its modules, mounts and thrusters, for the
   * sake of a page that is showing twelve of them. The oldest go first, which
   * on a seek means the ones already scrolled past.
   */
  const pictureOf = (id: number, entrant: Entrant): Picture => {
    const held = pictures.get(id);
    if (held !== undefined) return held;
    const fleet = isFleet(entrant) ? entrant : shipFleet(entrant);
    const compiled = new Map<string, ShipDesign>();
    const ships = expandFleet(fleet);
    const designs = ships.map((ship) => {
      let design = compiled.get(ship.design);
      if (design === undefined) {
        design = compileBlueprint(fleet.designs[ship.design]!);
        compiled.set(ship.design, design);
      }
      return design;
    });
    const picture: Picture = { view: { ships, designs }, mass: designs.reduce((sum, d) => sum + d.mass, 0) };
    pictures.set(id, picture);
    while (pictures.size > DESIGNS_KEPT) {
      const oldest = pictures.keys().next();
      if (oldest.done === true) break;
      pictures.delete(oldest.value);
    }
    return picture;
  };

  /** Which generation the panel is showing, and the rows and matches in it. */
  const showing = (
    wanted = shown,
  ): { index: number; rows: Row[]; matches: readonly MatchRecord[] } => {
    const empty = { index: 0, rows: [], matches: [] };
    if (run === null) return { ...empty, rows: previewRows };
    const closed = run.generations.length;
    // The newest generation is the one being fought while there is one, and
    // the last one closed once there is not — a finished run must go on
    // showing what it finished with rather than an empty panel.
    const newest = run.done ? closed - 1 : closed;
    const index = wanted < 0 ? newest : Math.min(wanted, newest);
    if (index < 0) return empty;
    if (index >= closed) {
      const rows = run.living.individuals.map((individual) => ({
        id: individual.id,
        parent: individual.parent,
        matches: individual.matches,
        fitness: fitness(individual),
        survival: individual.matches > 0 ? individual.survival / individual.matches : 0,
        functional: individual.matches > 0 ? individual.functional / individual.matches : 0,
        damage: individual.matches > 0 ? individual.damage / individual.matches : 0,
        disabling: individual.matches > 0 ? individual.disabling / individual.matches : 0,
        race: individual.matches > 0 ? individual.race / individual.matches : 0,
        mass: pictureOf(individual.id, individual.entrant).mass,
        edits: individual.edits,
        entrant: individual.entrant,
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
      functional: individual.functional ?? 0,
      damage: individual.damage,
      disabling: individual.disabling ?? 0,
      race: individual.race,
      mass: individual.mass,
      edits: individual.edits,
      entrant: entrantOf(individual),
    }));
    return { index, rows, matches: record.matches };
  };

  const startReplay = (record: MatchRecord, rows: readonly Row[]): void => {
    const entrants: Entrant[] = [];
    for (const id of record.competitors) {
      const row = rows.find((candidate) => candidate.id === id);
      if (row !== undefined) entrants.push(row.entrant);
    }
    // One is enough: a match of one ship is a run's test of its piloting.
    if (entrants.length === 0 || run === null) return;
    replay = new Match(entrants, { ...run.config.match, seed: record.seed });
    replayOf = record;
    replayPlaying = true;
    skipping = false;
    playButton.textContent = 'Pause';
    // Asked for a battle, so show one: a match clicked in the list is the
    // whole reason the viewer is there.
    modeSelect.value = 'battle';
    applyMode();
  };

  const refresh = (): void => {
    const { index, rows, matches } = showing();
    if (modeSelect.value !== 'battle') showFleet(rows);

    shownGeneration.textContent = run === null ? '—' : String(index + 1);
    // Whether what is on show is the generation still being fought, which is
    // the one that changes while it is looked at.
    const live = run !== null && !run.done && index >= run.generations.length;
    fightingLabel.textContent = live ? ' · fighting' : '';
    latestButton.disabled = run === null || shown < 0;
    // Nothing to skip to once a run is over and the generation on show
    // fought one match: the list is all there will ever be.
    skipButton.disabled = run === null || (run.done && matches.length < 2);

    const ranked = [...rows].sort((a, b) => b.fitness - a.fitness);
    const best = ranked[0];
    shipsBody.replaceChildren();
    for (const row of run === null ? [] : ranked) {
      const tr = document.createElement('tr');
      if (row === best) tr.className = 'champion';
      for (const cell of [
        String(row.id),
        row.parent < 0 ? '—' : String(row.parent),
        row.fitness.toFixed(3),
        row.survival.toFixed(2),
        row.functional.toFixed(2),
        row.damage.toFixed(2),
        row.disabling.toFixed(2),
        row.race.toFixed(2),
        (row.mass / 1000).toFixed(1),
      ]) {
        const td = document.createElement('td');
        td.textContent = cell;
        tr.append(td);
      }
      tr.title = row.edits.length > 0 ? row.edits.join('\n') : 'a founder of the run';
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
        { name: 'hull kept', colour: '#7fd6a0', values: of((g) => g.mean.survival), dashed: true },
        { name: 'function kept', colour: '#b48ee0', values: of((g) => g.mean.functional), dashed: true },
        { name: 'damage', colour: '#e0655f', values: of((g) => g.mean.damage), dashed: true },
        { name: 'function taken', colour: '#e08ec0', values: of((g) => g.mean.disabling), dashed: true },
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
    chartSeries = series;
    paintChart();
    showLegend();

    const top = run === null ? null : finalist(run.record());
    saveButton.disabled = top === null;
    exportButton.disabled = top === null;
    measureButton.disabled = top === null || yardstick !== null;
    championLine.textContent =
      top === null
        ? '—'
        : savedAs?.id === top.individual.id
          ? savedAs.text
          : `#${top.individual.id}, best of generation ${top.generation + 1}: ` +
          `${top.individual.fitness.toFixed(3)} over ${top.individual.matches} matches, ` +
          `${(top.individual.mass / 1000).toFixed(1)} t`;
  };

  /** The run's best, renamed for the generation it came from, and its id. */
  const champion = (): { entrant: Entrant; id: number } | null => {
    if (run === null) return null;
    const top = finalist(run.record());
    if (top === null) return null;
    const entrant = entrantOf(top.individual);
    return { entrant: { ...entrant, name: `${entrant.name} g${top.generation + 1}` }, id: top.individual.id };
  };

  saveButton.addEventListener('click', () => {
    const best = champion();
    if (best === null) return;
    const { entrant } = best;
    if (isFleet(entrant)) fleetLibrary.save(entrant);
    else library.save(entrant);
    // Kept until there is a new best, so the next refresh does not wipe it.
    savedAs = {
      id: best.id,
      text: `saved as "${entrant.name}" — open it in the ${isFleet(entrant) ? 'fleet' : 'ship'} editor`,
    };
    championLine.textContent = savedAs.text;
  });
  exportButton.addEventListener('click', () => {
    const best = champion();
    if (best === null) return;
    const { entrant } = best;
    download(
      `${entrant.name.replace(/[^\w.-]+/g, '_')}.json`,
      isFleet(entrant) ? fleetFileText(entrant) : toFileText(entrant),
    );
  });
  measureButton.addEventListener('click', () => {
    if (run === null || run.generations.length === 0) return;
    const record = run.record();
    const chosen = benchmarkSelect.value;
    const benchmark = chosen === OWN_FINAL ? latest(record) : load(chosen);
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

  /**
   * Follow the newest generation again.
   *
   * Seeking the chart pins the panel to one generation, which is what it is
   * for — and there has to be a way back, or watching a run means starting it
   * over. It is a button rather than an entry in a list of generations
   * because the list was a worse way of doing what the chart already does
   * better: a thousand of them is not something to pick from.
   */
  latestButton.addEventListener('click', () => {
    shown = -1;
    refresh();
  });

  // ---- driving the run ---------------------------------------------------

  const setPaused = (next: boolean): void => {
    paused = next;
    pauseButton.textContent = paused ? 'Resume' : 'Pause';
  };

  startButton.addEventListener('click', () => {
    const founders = chosenFounders();
    if (founders.length === 0) {
      readout.textContent = 'Pick at least one ship or fleet to start from.';
      readout.className = 'warn';
      return;
    }
    readout.className = '';
    run = new Run(founders, readSetup().config);
    previewMatch = null;
    previewRows = [];
    savedAs = null;
    yardstick = null;
    measured = null;
    yardstickLine.textContent = 'Measure once there is something to measure.';
    pictures.clear();
    shown = -1;
    replay = null;
    replayOf = null;
    skipping = false;
    editsLine.textContent = '';
    watch(null);
    fleetBox.replaceChildren();
    fleetTiles.clear();
    fleetScale = 0;
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

  window.addEventListener('resize', resize);
  resize();
  applyMode();
  refreshPreview();

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

    if (replay !== null && replayPlaying && (replay.done || skipping)) {
      rollOn();
    }

    if (replay !== null && replayPlaying && !replay.done && !skipping) {
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

    if (!fleetBox.hidden && fleetScale !== fleetTarget && fleetTarget > 0) {
      fleetScale = easeScale(fleetScale, fleetTarget, FLEET_EASE);
      for (const tile of fleetTiles.values()) drawTile(tile);
    }

    watch(replay ?? (run === null ? previewMatch : null));
    playButton.disabled = replay === null;
    stepButton.disabled = replay === null;
    if (modeSelect.value === 'battle') paint();

    // A generation picked off the chart shows on the next frame rather than at
    // the next sample: seeking through a run is meant to read as the ships
    // changing, and a fifth of a second of lag reads as the page being stuck.
    if (reselected) {
      reselected = false;
      refresh();
      report();
    }

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
      watchingLabel.textContent =
        modeSelect.value === 'battle'
          ? previewMatch === null
            ? 'nothing to fight'
            : 'first match, unmutated'
          : `${previewRows.length} founders, unmutated`;
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
      watchingLabel.textContent = `${shown.rows.length} combatants of generation ${shown.index + 1}`;
    } else if (skipping) {
      watchingLabel.textContent = 'skipped · waiting for the next match';
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
