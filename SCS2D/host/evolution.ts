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
import { ARCS_KEY, draw, nextArcs, TEAM_SHOTS_KEY, teamColour, type Arcs } from '../render/canvas2d.js';
import { shipColours } from '../render/teams.js';
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
import { fitness, type Generation } from '../evolution/generation.js';
import { DEFAULT_MATCH, isFleet, Match, type Entrant, type MatchConfig } from '../evolution/match.js';
import { DEFAULT_FLEET_LIMITS } from '../evolution/fleetMutate.js';
import {
  DEFAULT_BUILD_WEIGHTS,
  DEFAULT_DOCTRINE_WEIGHTS,
  DEFAULT_KINDS,
  DEFAULT_LIMITS,
  doctrineWeights,
  type KindWeights,
} from '../evolution/mutate.js';
import { parseRunConfig, runConfigWarnings, serialiseRunConfig, type RunSetup } from '../evolution/configFile.js';
import { Coevolution, DEFAULT_COEVOLUTION, rivalSettings, type CoevolutionConfig, type SideSettings } from '../evolution/coevolution.js';
import {
  GridMeasure,
  latest,
  Yardstick,
  yardstickMatch,
  type ChampionGrid,
  type YardstickReport,
} from '../evolution/yardstick.js';
import {
  finalist,
  DEFAULT_RUN,
  Run,
  type GenerationRecord,
  entrantOf,
  generationSize,
  type GenerationSize,
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

/**
 * The box one kind of ship is drawn in, CSS pixels.
 *
 * One ship rather than a whole fleet: a fleet drawn entire is a scattering of
 * specks at any size that fits a row, which loses both the hull and the
 * composition. Drawn a kind at a time with a count beside it, the hull is
 * large enough to recognise and nothing about the fleet is lost.
 */
const TILE_WIDTH = 88;
const TILE_HEIGHT = 52;

/**
 * The box a whole fleet is drawn in, CSS pixels.
 *
 * Beside the kinds rather than instead of them: the kinds say what a fleet is
 * made of and this says how it is arranged, and neither is the other. Its own
 * scale, shared across the rows exactly as the ships' is, so formations
 * compare with formations and ships with ships — one scale for both would put
 * a formation a kilometre across and a hull ten metres long on the same ruler,
 * and whichever the ruler suited the other would be a dot or a smear.
 */
const FORMATION_WIDTH = 88;
const FORMATION_HEIGHT = 64;
/** How much of the way the fleet's scale closes on its target each frame. */
const FLEET_EASE = 0.15;

/** What the settings are saved under, so a refresh does not cost them. */
const SETUP_KEY = 'scs2d.evolution.setup';
/** Which panel sections are folded away, so a refresh keeps them so. */
const FOLDED_KEY = 'scs2d.evolution.folded';

/**
 * The settings each side of a co-evolution run has its own of: the cards in
 * `#sideA`, copied for side B with ids prefixed `b_`.
 */
const SIDE_FIELDS = [
  'population',
  'winners',
  'group',
  'massBudget',
  'fleetRadius',
  'fleetShips',
  'opDesign',
  'opMove',
  'opAdd',
  'opRemove',
  'opFork',
  'opMerge',
  'opSwap',
  'structural',
  'buildMove',
  'buildResize',
  'buildRefit',
  'buildFittings',
  'buildTuning',
  'buildFighter',
  'buildShape',
  'kindEngine',
  'kindStructure',
  'kindTank',
  'kindTurret',
  'kindBeamTurret',
  'kindHullGun',
  'kindHullBeam',
  'kindCore',
  'kindClaw',
  'kindPad',
  'doctrineTargeting',
  'doctrineApproach',
  'doctrineEscort',
  'doctrineAvoidance',
  'doctrineGunnery',
] as const;
type SideField = (typeof SIDE_FIELDS)[number];
const RIVAL = 'b_';

/**
 * Side B's box for each per-side setting, beside side A's: a copy of it with
 * its id prefixed, so every setting is one row, A's box and then B's, and
 * what it means is written once.
 */
function addRivalInputs(): void {
  for (const name of SIDE_FIELDS) {
    const a = el<HTMLInputElement>(name);
    const b = a.cloneNode(true) as HTMLInputElement;
    b.id = RIVAL + name;
    b.classList.add('rival');
    b.title = `Side B's ${a.closest('.field')?.querySelector('label')?.textContent ?? name}`;
    a.after(b);
  }
}

const FIELDS = [
  'configName',
  'generations',
  'population',
  'winners',
  'group',
  'minMatches',
  'massBudget',
  'fleetRadius',
  'fleetShips',
  'opDesign',
  'opMove',
  'opAdd',
  'opRemove',
  'opFork',
  'opMerge',
  'opSwap',
  'seed',
  'duration',
  'radius',
  'radiusSpread',
  'scatter',
  'closing',
  'closingSpread',
  'crossing',
  'crossingSpread',
  'survivalWeight',
  'functionalWeight',
  'damageWeight',
  'disablingWeight',
  'raceWeight',
  'structural',
  'buildMove',
  'buildResize',
  'buildRefit',
  'buildFittings',
  'buildTuning',
  'buildFighter',
  'buildShape',
  'kindEngine',
  'kindStructure',
  'kindTank',
  'kindTurret',
  'kindBeamTurret',
  'kindHullGun',
  'kindHullBeam',
  'kindCore',
  'kindClaw',
  'kindPad',
  'doctrineTargeting',
  'doctrineApproach',
  'doctrineEscort',
  'doctrineAvoidance',
  'doctrineGunnery',
  'effort',
  'hall',
  'hallShare',
] as const;

/** One line of the results table, from a finished generation or a live one. */
interface Row {
  readonly id: number;
  /** Which lineage of a co-evolution run it is in, 0 for A and 1 for B; absent in a run of one. */
  readonly side?: 0 | 1;
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

/**
 * The five parts a score is made of, in the order they are shown.
 *
 * One list rather than a header written here and a figure read there: a
 * column and the number under it cannot drift apart if they are the same
 * entry. The colours are the chart's, applied by `css` in the stylesheet.
 */
const SCORE_COLUMNS = [
  { css: 'hull', head: 'hull', title: 'hull kept', of: (row: Row): number => row.survival },
  { css: 'func', head: 'func', title: 'function kept', of: (row: Row): number => row.functional },
  { css: 'dmg', head: 'dmg', title: 'damage done', of: (row: Row): number => row.damage },
  { css: 'dis', head: 'dis', title: 'function taken', of: (row: Row): number => row.disabling },
  { css: 'grnd', head: 'grnd', title: 'ground gained', of: (row: Row): number => row.race },
] as const;

/**
 * The combatants table's score columns: what was kept over what was kept
 * working, and what was done over what was disabled, so a row's height is
 * used and the table is narrow enough for two sides beside each other.
 * Indices into `SCORE_COLUMNS`.
 */
const STACKED_COLUMNS: readonly (readonly number[])[] = [[0, 1], [2, 3], [4]];

/**
 * A combatants table, built once: a header that never changes and an empty
 * body for the rows to be appended to and reordered in.
 */
function buildCombatantTable(host: HTMLElement): {
  table: HTMLTableElement;
  body: HTMLTableSectionElement;
} {
  const table = document.createElement('table');
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const [css, text, title] of [
    ['who', '#', 'rank, and what it was bred from'],
    ['formation', 'fleet', 'how it is arranged, to its own scale'],
    ['made', 'made of', 'every kind of ship in it, and how many'],
    ['score', 'score', 'against this generation’s opponents'],
    ['parts', '', ''],
    ['mass', 't', 'tonnes'],
    ['done', 'changed', 'what was done to its parent to make it'],
  ] as const) {
    if (css !== 'parts') {
      const th = document.createElement('th');
      th.className = css;
      th.textContent = text;
      th.title = title;
      headRow.append(th);
      continue;
    }
    for (const stack of STACKED_COLUMNS) {
      const th = document.createElement('th');
      th.className = 'part';
      for (const i of stack) {
        const column = SCORE_COLUMNS[i]!;
        const head = document.createElement('div');
        head.className = column.css;
        head.textContent = column.head;
        head.title = column.title;
        th.append(head);
      }
      headRow.append(th);
    }
  }
  head.append(headRow);
  const body = document.createElement('tbody');
  table.append(head, body);
  host.append(table);
  return { table, body };
}

/** One kind of ship in a combatant, and how many of that kind it has. */
interface ShipKind {
  readonly name: string;
  readonly design: ShipDesign;
  readonly count: number;
}

/**
 * An individual laid out to draw — a ship as a fleet of one — what it weighs,
 * and what kinds of ship it is made of.
 */
interface Picture {
  readonly view: Pick<FleetView, 'ships' | 'designs'>;
  readonly mass: number;
  /** Largest first: a fleet is read by its heaviest ship before its escorts. */
  readonly kinds: readonly ShipKind[];
}

/** A combatant's row in the table, and the scale its hulls were last drawn at. */
interface Tile {
  readonly tr: HTMLTableRowElement;
  readonly cells: Record<'who' | 'made' | 'score' | 'mass' | 'done', HTMLTableCellElement>;
  /** One per part, in `SCORE_COLUMNS` order. */
  readonly parts: readonly HTMLElement[];
  readonly canvases: readonly HTMLCanvasElement[];
  readonly formation: HTMLCanvasElement;
  readonly picture: Picture;
  drawnAt: number;
  formationDrawnAt: number;
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

const NO_LAYOUT: ChartLayout = { x: 0, y: 0, width: 0, height: 0, count: 0 };

/** One of the small charts under the score, and where it last drew itself. */
interface SizeChart {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly legend: HTMLElement;
  /** Places the legend reads a value to. */
  readonly digits: number;
  series: Series[];
  layout: ChartLayout;
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
  /**
   * What one fleet of each generation weighs and fields — averaged over the
   * generation, and for its fittest — under what it scored: a run that
   * scores better by growing is not the run that scores better by paring
   * down. Ships only once a run has fielded more than one.
   */
  const sizeChart = (canvas: string, key: string, digits: number): SizeChart => {
    const at = el<HTMLCanvasElement>(canvas);
    return { canvas: at, ctx: context(at), legend: el<HTMLElement>(key), digits, series: [], layout: NO_LAYOUT };
  };
  const massChart = sizeChart('massChart', 'massLegend', 1);
  const sizeCharts = [massChart];
  /** Worked out once per generation: a fleet's ship count means parsing it. */
  const sizes = new WeakMap<GenerationRecord, GenerationSize>();
  const sizeOf = (generation: GenerationRecord): GenerationSize => {
    let size = sizes.get(generation);
    if (size === undefined) {
      size = generationSize(generation);
      sizes.set(generation, size);
    }
    return size;
  };

  const startButton = el<HTMLButtonElement>('start');
  const toSetupButton = el<HTMLButtonElement>('toSetup');
  const toRunButton = el<HTMLButtonElement>('toRun');
  const pauseButton = el<HTMLButtonElement>('pause');
  const stopButton = el<HTMLButtonElement>('stop');
  const stateLabel = el<HTMLElement>('state');
  const readout = el<HTMLElement>('readout');
  const barFill = el<HTMLElement>('barFill');
  const foundersSelect = el<HTMLSelectElement>('founders');
  const versusSelect = el<HTMLSelectElement>('versus');
  const goalInput = el<HTMLSelectElement>('goal');
  const playButton = el<HTMLButtonElement>('play');
  const stepButton = el<HTMLButtonElement>('step');
  const skipButton = el<HTMLButtonElement>('skip');
  const fitButton = el<HTMLButtonElement>('fit');
  const speedSelect = el<HTMLSelectElement>('speed');
  const modeSelect = el<HTMLSelectElement>('mode');
  const battleControls = el<HTMLElement>('battleControls');
  const fleetBox = el<HTMLElement>('fleet');
  // One table a side, A's on the left; a run of one fills A's alone.
  const emptyNote = document.createElement('p');
  emptyNote.className = 'none';
  const fleetPair = document.createElement('div');
  fleetPair.className = 'pair';
  fleetBox.append(emptyNote, fleetPair);
  const fleetSides = [buildCombatantTable(fleetPair), buildCombatantTable(fleetPair)] as const;
  const watchingLabel = el<HTMLElement>('watching');
  const battleScores = el<HTMLElement>('battleScores');
  const latestButton = el<HTMLButtonElement>('latest');
  const shownGeneration = el<HTMLElement>('shownGeneration');
  const fightingLabel = el<HTMLElement>('fighting');
  const matchesBody = el<HTMLElement>('matches');
  const championLine = el<HTMLElement>('championLine');
  const saveButton = el<HTMLButtonElement>('saveChampion');
  const exportButton = el<HTMLButtonElement>('exportChampion');
  const benchmarkSelect = el<HTMLSelectElement>('benchmark');
  const measureButton = el<HTMLButtonElement>('measure');
  const watchYardstickButton = el<HTMLButtonElement>('watchYardstick');
  const yardstickLine = el<HTMLElement>('yardstickLine');
  const gridTable = el<HTMLTableElement>('grid');
  addRivalInputs();
  const inputs = Object.fromEntries(
    FIELDS.map((name) => [name, el<HTMLInputElement>(name)]),
  ) as Record<(typeof FIELDS)[number], HTMLInputElement>;
  const rivalFollowing = el<HTMLElement>('rivalFollowing');
  const rivalEvolvesInput = el<HTMLInputElement>('rivalEvolves');
  const rivalInputs = Object.fromEntries(
    SIDE_FIELDS.map((name) => [name, el<HTMLInputElement>(RIVAL + name)]),
  ) as Record<SideField, HTMLInputElement>;

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

  /** Side B's founders: any makes it a co-evolution run. */
  const chosenVersus = (): Entrant[] => {
    const rivals: Entrant[] = [];
    for (const option of versusSelect.selectedOptions) {
      try {
        const rival = load(option.value);
        if (rival !== null) rivals.push(rival);
      } catch {
        // As for a founder.
      }
    }
    return rivals;
  };
  /** How side B is bred against side A: its own column of settings, and the hall. */
  const coevolutionSettings = (): CoevolutionConfig => ({
    // Nothing set apart while side B follows side A, so a file says only what differs.
    rival: rivalOwn ? sideSettings((name) => rivalInputs[name]) : {},
    hall: Math.max(0, Math.round(number(inputs.hall, DEFAULT_COEVOLUTION.hall))),
    hallShare: Math.min(1, Math.max(0, number(inputs.hallShare, DEFAULT_COEVOLUTION.hallShare))),
    rivalEvolves: rivalEvolvesInput.checked,
  });
  const coRun = (): boolean => versusSelect.selectedOptions.length > 0;
  /** Whether side B has settings of its own, rather than following side A's. */
  let rivalOwn = false;

  let run: Run | Coevolution | null = null;
  /** Before a run: the founders as chosen, and the first match they would fight, paused at its start. */
  let previewRows: Row[] = [];
  let previewMatch: Match | null = null;
  /** What saving the best said, and which individual it was. */
  let savedAs: { id: number; text: string } | null = null;
  /** Said in place of the run's progress until the next Start, so the next report does not wipe it. */
  let notice = '';
  let paused = false;
  let replay: Match | null = null;
  let replayOf: MatchRecord | null = null;
  /** Who is fighting in the match being watched, by id, and an opponent that has none. */
  let replayIds: readonly number[] = [];
  let replayVs: string | null = null;
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
   * Every measurement of this run so far, by the opponent's file text, so
   * measuring against the same opponent again carries on from what was found
   * rather than fighting every generation over again.
   */
  const measurements = new Map<string, YardstickReport>();
  let measuringAgainst = '';
  /** A co-evolution run's champion grid, being fought or fought. */
  let grid: GridMeasure | null = null;
  let gridResult: ChampionGrid | null = null;
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
  /** The same, for the whole-fleet pictures: see `FORMATION_WIDTH`. */
  let formationScale = 0;
  let formationTarget = 0;
  let picked = -1;
  /** Where the chart drew itself, and which point the pointer is over. */
  let chartLayout: ChartLayout = NO_LAYOUT;
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
  let arcs: Arcs = 'none';
  // On here and off on the viewer: a run is watched to see who is doing what,
  // a single battle as much to see it.
  let teamShots = true;
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
    configName: '',
    generations: String(DEFAULT_RUN.generations),
    population: String(DEFAULT_RUN.population),
    winners: String(DEFAULT_RUN.winners),
    group: String(DEFAULT_RUN.group),
    minMatches: String(DEFAULT_RUN.minMatches),
    massBudget: '',
    fleetRadius: String(DEFAULT_FLEET_LIMITS.radius),
    fleetShips: String(DEFAULT_FLEET_LIMITS.maxShips),
    opDesign: String(DEFAULT_FLEET_LIMITS.operators.design),
    opMove: String(DEFAULT_FLEET_LIMITS.operators.move),
    opAdd: String(DEFAULT_FLEET_LIMITS.operators.add),
    opRemove: String(DEFAULT_FLEET_LIMITS.operators.remove),
    opFork: String(DEFAULT_FLEET_LIMITS.operators.fork),
    opMerge: String(DEFAULT_FLEET_LIMITS.operators.merge),
    opSwap: String(DEFAULT_FLEET_LIMITS.operators.swap),
    seed: String(DEFAULT_RUN.seed),
    duration: String(DEFAULT_MATCH.duration),
    radius: String(DEFAULT_MATCH.radius),
    scatter: String(Math.round((DEFAULT_MATCH.scatter * 180) / Math.PI)),
    closing: String(DEFAULT_MATCH.closingSpeed),
    crossing: String(DEFAULT_MATCH.crossingSpeed),
    radiusSpread: String(DEFAULT_MATCH.radiusSpread),
    closingSpread: String(DEFAULT_MATCH.closingSpread),
    crossingSpread: String(DEFAULT_MATCH.crossingSpread),
    survivalWeight: String(DEFAULT_MATCH.weights.survival),
    functionalWeight: String(DEFAULT_MATCH.weights.functional),
    damageWeight: String(DEFAULT_MATCH.weights.damage),
    disablingWeight: String(DEFAULT_MATCH.weights.disabling),
    raceWeight: String(DEFAULT_MATCH.weights.race),
    structural: String(DEFAULT_LIMITS.structural),
    buildMove: String(DEFAULT_BUILD_WEIGHTS.move),
    buildResize: String(DEFAULT_BUILD_WEIGHTS.resize),
    buildRefit: String(DEFAULT_BUILD_WEIGHTS.refit),
    buildFittings: String(DEFAULT_BUILD_WEIGHTS.fittings),
    buildTuning: String(DEFAULT_BUILD_WEIGHTS.tuning),
    buildFighter: String(DEFAULT_BUILD_WEIGHTS.fighter),
    buildShape: String(DEFAULT_BUILD_WEIGHTS.shape),
    kindEngine: String(DEFAULT_KINDS.engine),
    kindStructure: String(DEFAULT_KINDS.structure),
    kindTank: String(DEFAULT_KINDS.tank),
    kindTurret: String(DEFAULT_KINDS.turret),
    kindBeamTurret: String(DEFAULT_KINDS.beamTurret),
    kindHullGun: String(DEFAULT_KINDS.hullGun),
    kindHullBeam: String(DEFAULT_KINDS.hullBeam),
    kindCore: String(DEFAULT_KINDS.core),
    kindClaw: String(DEFAULT_KINDS.claw),
    kindPad: String(DEFAULT_KINDS.pad),
    doctrineTargeting: String(DEFAULT_DOCTRINE_WEIGHTS.targeting),
    doctrineApproach: String(DEFAULT_DOCTRINE_WEIGHTS.approach),
    doctrineEscort: String(DEFAULT_DOCTRINE_WEIGHTS.escort),
    doctrineAvoidance: String(DEFAULT_DOCTRINE_WEIGHTS.avoidance),
    doctrineGunnery: String(DEFAULT_DOCTRINE_WEIGHTS.gunnery),
    effort: '12',
    hall: String(DEFAULT_COEVOLUTION.hall),
    hallShare: String(DEFAULT_COEVOLUTION.hallShare),
  };

  /**
   * Show what Start would begin with. Only while there is no run: once one
   * has been fought, its results are what the panel is for.
   */
  const refreshPreview = (): void => {
    showFleetSettings();
    if (run !== null) return;
    for (const id of [...pictures.keys()]) if (id < 0) pictures.delete(id);
    for (const [id, tile] of [...fleetTiles]) {
      if (id >= 0) continue;
      tile.tr.remove();
      fleetTiles.delete(id);
    }
    const founders = chosenFounders();
    const rivals = chosenVersus();
    const co = rivals.length > 0;
    previewRows = [...founders, ...rivals].map((entrant, k) => ({
      id: -(k + 1),
      ...(co ? { side: k < founders.length ? (0 as const) : (1 as const) } : {}),
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
      previewMatch =
        founders.length === 0
          ? null
          : co
            ? new Coevolution(founders, rivals, readSetup().config, coevolutionSettings()).unmutatedOpening()
            : new Run(founders, readSetup().config).unmutatedOpening();
    } catch {
      // A founder that will not compile has nothing to show.
      previewMatch = null;
    }
    refresh();
  };

  const saveSetup = (): void => {
    const held: Record<string, string> = { goal: goalInput.value };
    for (const name of FIELDS) held[name] = inputs[name].value;
    // Side B follows side A until it is given a setting of its own.
    if (!rivalOwn) for (const name of SIDE_FIELDS) rivalInputs[name].value = inputs[name].value;
    for (const name of SIDE_FIELDS) held[RIVAL + name] = rivalInputs[name].value;
    held['rivalOwn'] = rivalOwn ? '1' : '';
    held['rivalEvolves'] = rivalEvolvesInput.checked ? '1' : '';
    document.body.classList.toggle('rivalFixed', !rivalEvolvesInput.checked);
    rivalFollowing.textContent = !rivalEvolvesInput.checked
      ? 'Side B does not evolve: it fights as its founders every generation, so it has no settings of its own.'
      : rivalOwn
        ? 'Side B has settings of its own, in the right-hand boxes.'
        : "Side B follows side A's settings until one of its own boxes, on the right, is changed.";
    held['founders'] = [...foundersSelect.selectedOptions].map((o) => o.value).join('\n');
    held['versus'] = [...versusSelect.selectedOptions].map((o) => o.value).join('\n');
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

  // Sections fold as the player left them.
  const folded = new Set<string>();
  try {
    for (const key of JSON.parse(window.localStorage.getItem(FOLDED_KEY) ?? '[]') as string[]) folded.add(key);
  } catch {
    // Unreadable is as good as nothing folded.
  }
  for (const section of document.querySelectorAll<HTMLDetailsElement>('details[data-key]')) {
    const key = section.dataset['key']!;
    if (folded.has(key)) section.open = false;
    section.addEventListener('toggle', () => {
      if (section.open) folded.delete(key);
      else folded.add(key);
      try {
        window.localStorage.setItem(FOLDED_KEY, JSON.stringify([...folded]));
      } catch {
        // Costs the folding, not the run.
      }
    });
  }

  const held = loadSetup();
  for (const name of FIELDS) inputs[name].value = held[name] ?? defaults[name];
  rivalOwn = held['rivalOwn'] === '1';
  rivalEvolvesInput.checked = held['rivalEvolves'] !== '';
  rivalEvolvesInput.addEventListener('change', saveSetup);
  for (const name of SIDE_FIELDS) rivalInputs[name].value = (rivalOwn ? held[RIVAL + name] : undefined) ?? inputs[name].value;
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

  fillList(versusSelect, (stock, name) => (stock ? name : `${name} (saved)`));
  const wantedVersus = new Set((held['versus'] ?? '').split('\n').filter((value) => value !== ''));
  for (const option of versusSelect.options) option.selected = wantedVersus.has(option.value);


  const OWN_FINAL = '';
  benchmarkSelect.append(new Option('its own final design', OWN_FINAL));
  fillList(benchmarkSelect, (_, name) => name);

  /** Whether a fleet is among the founders, which makes it a run of fleets. */
  const fleetRun = (): boolean =>
    [...foundersSelect.selectedOptions, ...versusSelect.selectedOptions].some((o) => pickOf(o.value).kind === 'fleet') ||
    Math.round(number(inputs.fleetShips, DEFAULT_FLEET_LIMITS.maxShips)) > 1 ||
    (coRun() && Math.round(number(rivalInputs.fleetShips, DEFAULT_FLEET_LIMITS.maxShips)) > 1);
  const showFleetSettings = (): void => {
    document.body.classList.toggle('fleetRun', fleetRun());
    document.body.classList.toggle('coRun', coRun());
  };
  showFleetSettings();
  foundersSelect.addEventListener('change', showFleetSettings);
  versusSelect.addEventListener('change', showFleetSettings);
  versusSelect.addEventListener('change', saveSetup);
  el<HTMLButtonElement>('clearVersus').addEventListener('click', () => {
    for (const option of versusSelect.options) option.selected = false;
    showFleetSettings();
    saveSetup();
  });

  for (const name of FIELDS) inputs[name].addEventListener('change', saveSetup);
  for (const name of SIDE_FIELDS) {
    rivalInputs[name].addEventListener('change', () => {
      rivalOwn = true;
      saveSetup();
    });
  }
  el<HTMLButtonElement>('sameAsA').addEventListener('click', () => {
    rivalOwn = false;
    showFleetSettings();
    saveSetup();
  });
  goalInput.addEventListener('change', saveSetup);
  foundersSelect.addEventListener('change', saveSetup);

  /** One side's own settings, read from its inputs: side A's, or with `get` reading side B's. */
  const sideSettings = (get: (name: SideField) => HTMLInputElement): SideSettings => {
    const tonnes = number(get('massBudget'), 0);
    return {
      population: Math.max(2, Math.round(number(get('population'), DEFAULT_RUN.population))),
      winners: Math.max(1, Math.round(number(get('winners'), DEFAULT_RUN.winners))),
      group: Math.max(1, Math.round(number(get('group'), DEFAULT_RUN.group))),
      massBudget: tonnes > 0 ? tonnes * 1000 : Infinity,
      fleet: {
        radius: Math.max(1, number(get('fleetRadius'), DEFAULT_FLEET_LIMITS.radius)),
        maxShips: Math.max(1, Math.round(number(get('fleetShips'), DEFAULT_FLEET_LIMITS.maxShips))),
        operators: {
          design: Math.max(0, number(get('opDesign'), DEFAULT_FLEET_LIMITS.operators.design)),
          move: Math.max(0, number(get('opMove'), DEFAULT_FLEET_LIMITS.operators.move)),
          add: Math.max(0, number(get('opAdd'), DEFAULT_FLEET_LIMITS.operators.add)),
          remove: Math.max(0, number(get('opRemove'), DEFAULT_FLEET_LIMITS.operators.remove)),
          fork: Math.max(0, number(get('opFork'), DEFAULT_FLEET_LIMITS.operators.fork)),
          merge: Math.max(0, number(get('opMerge'), DEFAULT_FLEET_LIMITS.operators.merge)),
          swap: Math.max(0, number(get('opSwap'), DEFAULT_FLEET_LIMITS.operators.swap)),
        },
      },
      mutation: {
        structural: Math.min(1, Math.max(0, number(get('structural'), DEFAULT_LIMITS.structural))),
        build: {
          move: Math.max(0, number(get('buildMove'), DEFAULT_BUILD_WEIGHTS.move)),
          resize: Math.max(0, number(get('buildResize'), DEFAULT_BUILD_WEIGHTS.resize)),
          refit: Math.max(0, number(get('buildRefit'), DEFAULT_BUILD_WEIGHTS.refit)),
          fittings: Math.max(0, number(get('buildFittings'), DEFAULT_BUILD_WEIGHTS.fittings)),
          tuning: Math.max(0, number(get('buildTuning'), DEFAULT_BUILD_WEIGHTS.tuning)),
          fighter: Math.max(0, number(get('buildFighter'), DEFAULT_BUILD_WEIGHTS.fighter)),
          shape: Math.max(0, number(get('buildShape'), DEFAULT_BUILD_WEIGHTS.shape)),
        },
        kinds: {
          engine: Math.max(0, number(get('kindEngine'), DEFAULT_KINDS.engine)),
          structure: Math.max(0, number(get('kindStructure'), DEFAULT_KINDS.structure)),
          tank: Math.max(0, number(get('kindTank'), DEFAULT_KINDS.tank)),
          turret: Math.max(0, number(get('kindTurret'), DEFAULT_KINDS.turret)),
          beamTurret: Math.max(0, number(get('kindBeamTurret'), DEFAULT_KINDS.beamTurret)),
          hullGun: Math.max(0, number(get('kindHullGun'), DEFAULT_KINDS.hullGun)),
          hullBeam: Math.max(0, number(get('kindHullBeam'), DEFAULT_KINDS.hullBeam)),
          core: Math.max(0, number(get('kindCore'), DEFAULT_KINDS.core)),
          claw: Math.max(0, number(get('kindClaw'), DEFAULT_KINDS.claw)),
          pad: Math.max(0, number(get('kindPad'), DEFAULT_KINDS.pad)),
        },
        doctrine: {
          targeting: Math.max(0, number(get('doctrineTargeting'), DEFAULT_DOCTRINE_WEIGHTS.targeting)),
          approach: Math.max(0, number(get('doctrineApproach'), DEFAULT_DOCTRINE_WEIGHTS.approach)),
          escort: Math.max(0, number(get('doctrineEscort'), DEFAULT_DOCTRINE_WEIGHTS.escort)),
          avoidance: Math.max(0, number(get('doctrineAvoidance'), DEFAULT_DOCTRINE_WEIGHTS.avoidance)),
          gunnery: Math.max(0, number(get('doctrineGunnery'), DEFAULT_DOCTRINE_WEIGHTS.gunnery)),
        },
      },
    };
  };

  const configure = (): Partial<RunConfig> => {
    return {
      seed: number(inputs.seed, DEFAULT_RUN.seed),
      generations: Math.max(1, Math.round(number(inputs.generations, DEFAULT_RUN.generations))),
      minMatches: Math.max(1, Math.round(number(inputs.minMatches, DEFAULT_RUN.minMatches))),
      ...sideSettings((name) => inputs[name]),
      match: {
        duration: Math.max(1, number(inputs.duration, DEFAULT_MATCH.duration)),
        radius: Math.max(10, number(inputs.radius, DEFAULT_MATCH.radius)),
        scatter: (number(inputs.scatter, 180) * Math.PI) / 180,
        closingSpeed: number(inputs.closing, DEFAULT_MATCH.closingSpeed),
        crossingSpeed: number(inputs.crossing, DEFAULT_MATCH.crossingSpeed),
        radiusSpread: Math.max(0, number(inputs.radiusSpread, DEFAULT_MATCH.radiusSpread)),
        closingSpread: Math.max(0, number(inputs.closingSpread, DEFAULT_MATCH.closingSpread)),
        crossingSpread: Math.max(0, number(inputs.crossingSpread, DEFAULT_MATCH.crossingSpread)),
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
    const name = inputs.configName.value.trim();
    return {
      ...(name === '' ? {} : { name }),
      founders: picked.filter((p) => p.kind === 'ship').map((p) => p.name),
      fleets: picked.filter((p) => p.kind === 'fleet').map((p) => p.name),
      versus: coRun() ? { ...versusNames(), coevolution: coevolutionSettings() } : null,
      config: { ...DEFAULT_RUN, ...configure() },
    };
  };

  /** Side B's founders, by name, as a config file holds them. */
  const versusNames = (): { founders: string[]; fleets: string[] } => {
    const picked = [...versusSelect.selectedOptions].map((option) => pickOf(option.value));
    return {
      founders: picked.filter((p) => p.kind === 'ship').map((p) => p.name),
      fleets: picked.filter((p) => p.kind === 'fleet').map((p) => p.name),
    };
  };

  /**
   * Put a setup into the form.
   *
   * A ship the library does not have is dropped rather than refused: a config
   * is worth reading for its numbers even when it names somebody else's ship,
   * and what is missing is visible in the founders list.
   */
  /** Put one side's own settings into its inputs: side A's, or with `get` side B's. */
  const writeSide = (get: (name: SideField) => HTMLInputElement, config: RunConfig): void => {
    const kinds: KindWeights = { ...DEFAULT_KINDS, ...config.mutation.kinds };
    get('population').value = String(config.population);
    get('winners').value = String(config.winners);
    get('group').value = String(config.group);
    get('massBudget').value = Number.isFinite(config.massBudget) ? String(config.massBudget / 1000) : '';
    get('fleetRadius').value = String(config.fleet.radius ?? DEFAULT_FLEET_LIMITS.radius);
    get('fleetShips').value = String(config.fleet.maxShips ?? DEFAULT_FLEET_LIMITS.maxShips);
    const operators = { ...DEFAULT_FLEET_LIMITS.operators, ...config.fleet.operators };
    get('opDesign').value = String(operators.design);
    get('opMove').value = String(operators.move);
    get('opAdd').value = String(operators.add);
    get('opRemove').value = String(operators.remove);
    get('opFork').value = String(operators.fork);
    get('opMerge').value = String(operators.merge);
    get('opSwap').value = String(operators.swap);
    const build = { ...DEFAULT_BUILD_WEIGHTS, ...config.mutation.build };
    get('structural').value = String(config.mutation.structural ?? DEFAULT_LIMITS.structural);
    get('buildMove').value = String(build.move);
    get('buildResize').value = String(build.resize);
    get('buildRefit').value = String(build.refit);
    get('buildFittings').value = String(build.fittings);
    get('buildTuning').value = String(build.tuning);
    get('buildFighter').value = String(build.fighter);
    get('buildShape').value = String(build.shape);
    get('kindEngine').value = String(kinds.engine);
    get('kindStructure').value = String(kinds.structure);
    get('kindTank').value = String(kinds.tank);
    get('kindTurret').value = String(kinds.turret);
    get('kindBeamTurret').value = String(kinds.beamTurret);
    get('kindHullGun').value = String(kinds.hullGun);
    get('kindHullBeam').value = String(kinds.hullBeam);
    get('kindCore').value = String(kinds.core);
    get('kindClaw').value = String(kinds.claw);
    get('kindPad').value = String(kinds.pad);
    const doctrine = doctrineWeights(config.mutation.doctrine);
    get('doctrineTargeting').value = String(doctrine.targeting);
    get('doctrineApproach').value = String(doctrine.approach);
    get('doctrineEscort').value = String(doctrine.escort);
    get('doctrineAvoidance').value = String(doctrine.avoidance);
    get('doctrineGunnery').value = String(doctrine.gunnery);
  };

  const applySetup = (setup: RunSetup): void => {
    const config = setup.config;
    const match: MatchConfig = { ...DEFAULT_MATCH, ...config.match };
    inputs.configName.value = setup.name ?? '';
    inputs.seed.value = String(config.seed);
    inputs.generations.value = String(config.generations);
    inputs.minMatches.value = String(config.minMatches);
    inputs.duration.value = String(match.duration);
    inputs.radius.value = String(match.radius);
    inputs.scatter.value = String((match.scatter * 180) / Math.PI);
    inputs.closing.value = String(match.closingSpeed);
    inputs.crossing.value = String(match.crossingSpeed);
    inputs.radiusSpread.value = String(match.radiusSpread ?? DEFAULT_MATCH.radiusSpread);
    inputs.closingSpread.value = String(match.closingSpread ?? DEFAULT_MATCH.closingSpread);
    inputs.crossingSpread.value = String(match.crossingSpread ?? DEFAULT_MATCH.crossingSpread);
    inputs.survivalWeight.value = String(match.weights.survival);
    inputs.functionalWeight.value = String(match.weights.functional);
    inputs.damageWeight.value = String(match.weights.damage);
    inputs.disablingWeight.value = String(match.weights.disabling);
    inputs.raceWeight.value = String(match.weights.race);
    writeSide((name) => inputs[name], config);
    goalInput.value = match.goal === null ? 'none' : match.goal.solid === false ? 'ghost' : 'solid';
    const fleets = setup.fleets ?? [];
    if (setup.founders.length + fleets.length > 0) {
      const named = new Set([
        ...setup.founders.map((name) => valueOf('ship', name)),
        ...fleets.map((name) => valueOf('fleet', name)),
      ]);
      for (const option of foundersSelect.options) option.selected = named.has(option.value);
    }
    const versus = setup.versus ?? null;
    const coevolution = versus?.coevolution ?? DEFAULT_COEVOLUTION;
    // Side B's column in full: side A's settings, with whatever the file set apart for it.
    rivalOwn = Object.keys(coevolution.rival).length > 0;
    writeSide((name) => rivalInputs[name], rivalSettings({ ...DEFAULT_RUN, ...config }, coevolution.rival));
    inputs.hall.value = String(coevolution.hall);
    rivalEvolvesInput.checked = coevolution.rivalEvolves;
    inputs.hallShare.value = String(coevolution.hallShare);
    const rivals = new Set([
      ...(versus?.founders ?? []).map((name) => valueOf('ship', name)),
      ...(versus?.fleets ?? []).map((name) => valueOf('fleet', name)),
    ]);
    // Side B as the file has it, which for a run of one is nobody.
    for (const option of versusSelect.options) option.selected = rivals.has(option.value);
    showFleetSettings();
    saveSetup();
  };

  el<HTMLButtonElement>('exportConfig').addEventListener('click', () => {
    const setup = readSetup();
    const file = setup.name === undefined ? 'evolution-config' : setup.name.replace(/[^\w.-]+/g, '_');
    download(`${file}.json`, `${JSON.stringify(serialiseRunConfig(setup), null, 2)}\n`);
  });
  const file = el<HTMLInputElement>('importConfigFile');
  el<HTMLButtonElement>('importConfig').addEventListener('click', () => file.click());
  file.addEventListener('change', () => {
    const chosen = file.files?.[0];
    if (chosen === undefined) return;
    void chosen.text().then((text) => {
      let warnings: string[];
      try {
        const value: unknown = JSON.parse(text);
        applySetup(parseRunConfig(value));
        warnings = runConfigWarnings(value);
      } catch (error) {
        window.alert(`Could not read those settings.\n\n${error instanceof Error ? error.message : error}`);
        return;
      }
      // Read anyway: a key nothing reads is said, not refused.
      readout.className = warnings.length > 0 ? 'warn' : '';
      notice =
        'Settings read from a file. Press Start when you are ready.' +
        (warnings.length > 0 ? ` Not read: ${warnings.join('; ')}.` : '');
      readout.textContent = notice;
    });
    // Cleared so that choosing the same file twice is two imports rather
    // than one, which matters while a file is being edited beside the page.
    file.value = '';
  });

  // ---- the viewer --------------------------------------------------------

  const resize = (): void => {
    const ratio = window.devicePixelRatio || 1;
    for (const canvas of [view, chart, massChart.canvas]) {
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
    } else if (event.key.toLowerCase() === ARCS_KEY) {
      arcs = nextArcs(arcs);
    } else if (event.key.toLowerCase() === TEAM_SHOTS_KEY) {
      teamShots = !teamShots;
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
    // Aged before this step's are added, which are born now.
    flashes.step(simDt);
    for (let i = 0; i < shot.impactCount; i++) {
      flashes.add(
        shot.impactX[i]!,
        shot.impactY[i]!,
        shot.impactEnergy[i]!,
        shot.impactKind[i]!,
        shot.impactBody[i]!,
        shot.impactLocalX[i]!,
        shot.impactLocalY[i]!,
        shot.impactVx[i]!,
        shot.impactVy[i]!,
        shot.impactGrowth[i]!,
      );
    }
    draw(ctx, shot, camera, view.width, view.height, flashes, arcs, teamShots);
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
    for (const sub of sizeCharts) {
      sub.layout = drawChart(
        sub.ctx,
        sub.series,
        sub.canvas.width,
        sub.canvas.height,
        window.devicePixelRatio || 1,
        { hover: hoverAt ?? undefined, picked: markedGeneration() },
      );
    }
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
    fillLegend(legend, chartSeries, 3, '');
    // Ships are read on the right-hand scale, and to more places: a mean of
    // whole ships is a fraction.
    fillLegend(massChart.legend, massChart.series, massChart.digits, ' t', 2, '');
  }

  function fillLegend(
    into: HTMLElement,
    series: readonly Series[],
    digits: number,
    unit: string,
    rightDigits = digits,
    rightUnit = unit,
  ): void {
    into.replaceChildren();
    for (const line of series) {
      const entry = document.createElement('span');
      entry.style.color = line.colour;
      entry.textContent = line.name;
      const value = hoverAt === null ? undefined : line.values[hoverAt];
      if (value !== undefined && Number.isFinite(value)) {
        const reading = document.createElement('b');
        reading.textContent = line.right === true ? value.toFixed(rightDigits) + rightUnit : value.toFixed(digits) + unit;
        entry.append(reading);
      }
      into.append(entry);
    }
  }

  /** Which generation the pointer is over, as an index, or null. */
  const chartPointAt = (
    canvas: HTMLCanvasElement,
    layout: ChartLayout,
    event: PointerEvent | MouseEvent,
    clamp = false,
  ): number | null => {
    const rect = canvas.getBoundingClientRect();
    return indexAt(layout, event.clientX - rect.left, clamp);
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

  /** Hover and drag-to-seek, the same on every chart since they share an axis. */
  const seekable = (canvas: HTMLCanvasElement, layout: () => ChartLayout): void => {
    canvas.addEventListener('pointermove', (event) => {
      const at = chartPointAt(canvas, layout(), event, seeking);
      hoverChart(at);
      if (seeking && at !== null) goTo(at);
    });
    canvas.addEventListener('pointerleave', () => {
      if (!seeking) hoverChart(null);
    });
    canvas.addEventListener('pointerdown', (event) => {
      const at = chartPointAt(canvas, layout(), event, true);
      if (at === null) return;
      // Captured, so a drag that runs off the end of the plot goes on seeking
      // to the end of the run rather than stopping where the canvas does.
      canvas.setPointerCapture(event.pointerId);
      seeking = true;
      goTo(at);
    });
    const stopSeeking = (event: PointerEvent): void => {
      if (!seeking) return;
      seeking = false;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    canvas.addEventListener('pointerup', stopSeeking);
    canvas.addEventListener('pointercancel', stopSeeking);
  };
  seekable(chart, () => chartLayout);
  for (const sub of sizeCharts) seekable(sub.canvas, () => sub.layout);

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
    if (rows.length === 0) {
      for (const tile of fleetTiles.values()) tile.tr.remove();
      fleetTiles.clear();
      fleetPair.hidden = true;
      emptyNote.hidden = false;
      emptyNote.textContent = run === null ? 'Pick founders to see them here.' : 'Nothing bred yet.';
      return;
    }
    emptyNote.hidden = true;
    fleetPair.hidden = false;
    fleetSides[1].table.hidden = !rows.some((row) => row.side === 1);

    // One scale for every hull on show, so a ship twice the size of another
    // looks it — down a column as much as across a row. Set by whichever kind
    // of ship is largest, since that is the one a cell has to hold.
    fleetTarget = Infinity;
    formationTarget = Infinity;
    for (const row of rows) {
      const picture = pictureOf(row.id, row.entrant);
      for (const kind of picture.kinds) {
        const shot = oneShipSnapshot(kind);
        fleetTarget = Math.min(fleetTarget, fitScale(shot, TILE_WIDTH * ratio(), TILE_HEIGHT * ratio()));
      }
      const whole = fleetSnapshot(picture.view, tileSnapshot, NO_TEAM);
      formationTarget = Math.min(
        formationTarget,
        fitScale(whole, FORMATION_WIDTH * ratio(), FORMATION_HEIGHT * ratio()),
      );
    }
    if (fleetScale === 0) fleetScale = fleetTarget;
    if (formationScale === 0) formationScale = formationTarget;

    // Side by side in a co-evolution run, each ranked within its own lineage:
    // a fitness is a score against the other side, so the two do not compare.
    const ranked = [...rows].sort((a, b) => (a.side ?? 0) - (b.side ?? 0) || b.fitness - a.fitness);
    const living = new Set(ranked.map((row) => row.id));
    for (const [id, tile] of fleetTiles) {
      if (!living.has(id)) {
        tile.tr.remove();
        fleetTiles.delete(id);
      }
    }

    for (const [order, row] of ranked.entries()) {
      const rank = order - ranked.findIndex((other) => other.side === row.side);
      let tile = fleetTiles.get(row.id);
      if (tile === undefined) {
        tile = makeTile(row);
        fleetTiles.set(row.id, tile);
      }
      // Appending something already here moves it, so this is the reordering.
      fleetSides[row.side === 1 ? 1 : 0].body.append(tile.tr);
      tile.tr.classList.toggle('picked', row.id === picked);
      tile.tr.classList.toggle('champion', rank === 0 && row.id >= 0 && row.matches > 0);
      writeRow(tile, row, rank);
    }
  };

  /** One kind of ship alone at the origin, to draw or to measure. */
  const oneShipSnapshot = (kind: ShipKind): Snapshot =>
    fleetSnapshot(
      {
        ships: [{ design: kind.name, x: 0, y: 0, angle: 0, path: kind.name, entry: 0, trail: [] }],
        designs: [kind.design],
      },
      tileSnapshot,
      NO_TEAM,
    );

  /**
   * Fill in a combatant's row: who it is, what it is made of, what it scored,
   * and what was done to make it.
   *
   * **The figures are rewritten every refresh and the hulls are not.** A
   * generation's scores move while it is being fought; its designs never
   * change, since a design is replaced by a child rather than edited.
   */
  const writeRow = (tile: Tile, row: Row, rank: number): void => {
    const { who, score, mass, done } = tile.cells;

    who.replaceChildren();
    const name = document.createElement('b');
    // A preview's founders have no id yet; their names say more.
    name.textContent = row.id < 0 ? row.entrant.name : `${rank + 1}. #${row.id}`;
    if (row.side !== undefined) {
      const side = document.createElement('span');
      side.className = 'side';
      side.textContent = row.side === 0 ? 'A ' : 'B ';
      side.style.color = teamColour(row.side);
      side.title = row.side === 0 ? "side A: the founders' lineage" : 'side B: the lineage bred against it';
      who.append(side);
    }
    who.append(name);
    if (row.id >= 0) {
      const from = document.createElement('span');
      from.className = 'from';
      from.textContent = row.parent < 0 ? 'a founder' : `← #${row.parent}`;
      if (row.parent >= 0) from.title = `bred from #${row.parent}`;
      who.append(from);
    }

    score.textContent = row.id < 0 ? '' : row.matches > 0 ? row.fitness.toFixed(3) : '—';
    score.title = row.id < 0 ? '' : `${row.matches} match${row.matches === 1 ? '' : 'es'} fought`;

    for (const [i, part] of tile.parts.entries()) {
      // A dash rather than a row of zeroes for a design that has not fought:
      // its parts are as unknown as the score beside them, and a generation
      // still being fought is mostly made of those.
      part.textContent =
        row.id < 0 || row.matches === 0 ? '—' : SCORE_COLUMNS[i]!.of(row).toFixed(2);
    }

    // The unit is in the column head, so it is not repeated down the column.
    mass.textContent = (row.mass / 1000).toFixed(1);
    done.firstElementChild!.textContent =
      row.edits.length > 0 ? row.edits.join('; ') : row.id < 0 ? '' : '—';
  };

  /**
   * Build a combatant's row, with a picture of each kind of ship it has.
   *
   * The pictures are made here and never again: which kinds a design is made
   * of is fixed for its life, so only the shared scale can make them stale.
   */
  const makeTile = (row: Row): Tile => {
    const picture = pictureOf(row.id, row.entrant);
    const tr = document.createElement('tr');

    const cell = (className: string): HTMLTableCellElement => {
      const td = document.createElement('td');
      td.className = className;
      tr.append(td);
      return td;
    };

    const who = cell('who');

    // The fleet entire, to its own scale: what the kinds beside it cannot say.
    const formationCell = cell('formation');
    const formation = document.createElement('canvas');
    formation.width = Math.round(FORMATION_WIDTH * ratio());
    formation.height = Math.round(FORMATION_HEIGHT * ratio());
    formation.style.width = `${FORMATION_WIDTH}px`;
    formation.style.height = `${FORMATION_HEIGHT}px`;
    formation.title = `${picture.view.ships.length} ship${picture.view.ships.length === 1 ? '' : 's'} in formation`;
    formationCell.append(formation);

    const made = cell('made');
    const kinds = document.createElement('div');
    kinds.className = 'kinds';
    const canvases: HTMLCanvasElement[] = [];
    for (const kind of picture.kinds) {
      const box = document.createElement('div');
      box.className = 'kind';
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(TILE_WIDTH * ratio());
      canvas.height = Math.round(TILE_HEIGHT * ratio());
      canvas.style.width = `${TILE_WIDTH}px`;
      canvas.style.height = `${TILE_HEIGHT}px`;
      canvases.push(canvas);
      const of = document.createElement('span');
      of.className = 'of';
      of.title = `${kind.count} × ${kind.name}`;
      // No count on a lone ship: "×1" under one hull is noise.
      if (kind.count > 1) {
        const many = document.createElement('b');
        many.textContent = `×${kind.count} `;
        of.append(many);
      }
      of.append(kind.name);
      box.append(canvas, of);
      kinds.append(box);
    }
    made.append(kinds);

    const score = cell('score');
    const parts: HTMLElement[] = [];
    for (const stack of STACKED_COLUMNS) {
      const td = cell('part');
      for (const i of stack) {
        const column = SCORE_COLUMNS[i]!;
        const figure = document.createElement('div');
        figure.className = column.css;
        figure.title = column.title;
        td.append(figure);
        parts[i] = figure;
      }
    }
    const mass = cell('mass');
    const done = cell('done');
    done.append(document.createElement('div'));

    tr.addEventListener('click', () => {
      picked = row.id;
      for (const [id, other] of fleetTiles) other.tr.classList.toggle('picked', id === picked);
    });

    const tile: Tile = {
      tr,
      cells: { who, made, score, mass, done },
      parts,
      canvases,
      formation,
      picture,
      drawnAt: 0,
      formationDrawnAt: 0,
    };
    drawTile(tile);
    return tile;
  };

  /**
   * Draw a row's hulls at the shared scale, one kind of ship to a canvas.
   * Only when that scale has moved since they were last drawn: a design never
   * changes, it is replaced by a child.
   */
  const drawTile = (tile: Tile): void => {
    if (tile.formationDrawnAt !== formationScale) {
      const wholeCtx = tile.formation.getContext('2d');
      if (wholeCtx !== null) {
        const shot = fleetSnapshot(tile.picture.view, tileSnapshot, NO_TEAM);
        const eye: Camera = {
          x: (shot.minX + shot.maxX) / 2,
          y: (shot.minY + shot.maxY) / 2,
          scale: formationScale,
        };
        draw(wholeCtx, shot, eye, tile.formation.width, tile.formation.height);
        tile.formationDrawnAt = formationScale;
      }
    }

    if (tile.drawnAt === fleetScale) return;
    for (const [i, canvas] of tile.canvases.entries()) {
      const kind = tile.picture.kinds[i];
      const tileCtx = canvas.getContext('2d');
      if (kind === undefined || tileCtx === null) continue;
      const shot = oneShipSnapshot(kind);
      const eye: Camera = {
        x: (shot.minX + shot.maxX) / 2,
        y: (shot.minY + shot.maxY) / 2,
        scale: fleetScale,
      };
      draw(tileCtx, shot, eye, canvas.width, canvas.height);
    }
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
   * compiled designs, each with its modules, mounts and engines, for the
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
    // One entry per kind of ship, heaviest first: what a fleet is made of,
    // which is the thing a picture of the whole fleet cannot show at the size
    // a row gives it.
    const counted = new Map<string, { design: ShipDesign; count: number }>();
    ships.forEach((ship, i) => {
      const held = counted.get(ship.design);
      if (held === undefined) counted.set(ship.design, { design: designs[i]!, count: 1 });
      else held.count += 1;
    });
    const kinds: ShipKind[] = [...counted]
      .map(([name, { design, count }]) => ({ name, design, count }))
      .sort((a, b) => b.design.mass - a.design.mass || a.name.localeCompare(b.name));

    const picture: Picture = {
      view: { ships, designs },
      mass: designs.reduce((sum, d) => sum + d.mass, 0),
      kinds,
    };
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
    if (run instanceof Coevolution) {
      if (index >= closed) {
        return {
          index,
          rows: [...liveRows(run.living, 0), ...liveRows(run.rivalLiving, 1)],
          matches: bothSides(run.played, run.rivalPlayed),
        };
      }
      const a = run.generations[index]!;
      const b = run.rivalGenerations[index]!;
      return { index, rows: [...recordRows(a, 0), ...recordRows(b, 1)], matches: bothSides(a.matches, b.matches) };
    }
    if (index >= closed) return { index, rows: liveRows(run.living), matches: run.played };
    const record = run.generations[index]!;
    return { index, rows: recordRows(record), matches: record.matches };
  };

  /** A generation being fought, as rows; `side` for a lineage of a co-evolution run. */
  const liveRows = (generation: Generation, side?: 0 | 1): Row[] =>
    generation.individuals.map((individual) => ({
      id: individual.id,
      ...(side === undefined ? {} : { side }),
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

  /** A closed generation, as rows. */
  const recordRows = (record: GenerationRecord, side?: 0 | 1): Row[] =>
    record.individuals.map((individual) => ({
      id: individual.id,
      ...(side === undefined ? {} : { side }),
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

  /**
   * Both sides' matches, each once and in the order fought: a match between
   * the sides is in both lists, one against a champion only in the scored side's.
   */
  const bothSides = (a: readonly MatchRecord[], b: readonly MatchRecord[]): MatchRecord[] => {
    const seen = new Set(a.map((match) => match.seed));
    return [...a, ...b.filter((match) => !seen.has(match.seed))];
  };

  /** A design anywhere in the run, by id: a champion from a past generation is fought, but not on show. */
  const entrantById = (id: number): Entrant | null => {
    if (run === null) return null;
    const lists = run instanceof Coevolution ? [run.generations, run.rivalGenerations] : [run.generations];
    for (const generations of lists) {
      for (let g = generations.length - 1; g >= 0; g--) {
        const found = generations[g]!.individuals.find((individual) => individual.id === id);
        if (found !== undefined) return entrantOf(found);
      }
    }
    return null;
  };

  /** Who fought, by id; with sides, each side's led by its letter and the two split by a v. */
  const competitorsText = (record: MatchRecord): string => {
    const teams = record.teams;
    if (teams === undefined) return record.competitors.join(' ');
    return record.competitors
      .map((id, k) => {
        if (k > 0 && teams[k] === teams[k - 1]) return String(id);
        const letter = teams[k] === 0 ? 'A' : 'B';
        return k === 0 ? `${letter} ${id}` : `v ${letter} ${id}`;
      })
      .join(' ');
  };

  /** How a match ended: who won it, when it was decided and the record says. */
  const endingText = (record: MatchRecord): string => {
    const first = record.winners?.[0];
    if (record.ending !== 'decided' || first === undefined) return record.ending;
    if (record.teams !== undefined) return `${record.teams[first] === 0 ? 'A' : 'B'} won`;
    return `#${record.competitors[first]} won`;
  };

  const startReplay = (record: MatchRecord, rows: readonly Row[]): void => {
    const entrants: Entrant[] = [];
    for (const id of record.competitors) {
      const entrant = rows.find((candidate) => candidate.id === id)?.entrant ?? entrantById(id);
      if (entrant !== null) entrants.push(entrant);
    }
    // One is enough: a match of one ship is a run's test of its piloting.
    if (entrants.length === 0 || run === null) return;
    // As the run fought it: a co-evolution match has no goal, and has sides.
    const match = run instanceof Coevolution ? { ...run.config.match, goal: null } : run.config.match;
    const teams = record.teams !== undefined && record.teams.length === entrants.length ? record.teams : null;
    watchReplay(
      new Match(entrants, { ...match, seed: record.seed }, teams),
      record,
      record.competitors,
      null,
    );
  };

  const watchReplay = (
    match: Match,
    record: MatchRecord | null,
    ids: readonly number[],
    vs: string | null,
  ): void => {
    replay = match;
    replayOf = record;
    replayIds = ids;
    replayVs = vs;
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

    matchesBody.replaceChildren();
    for (const [i, record] of matches.entries()) {
      const tr = document.createElement('tr');
      if (record === replayOf) tr.className = 'watched';
      for (const cell of [
        String(i + 1),
        competitorsText(record),
        endingText(record),
        record.elapsed.toFixed(0),
      ]) {
        const td = document.createElement('td');
        td.textContent = cell;
        tr.append(td);
      }
      tr.addEventListener('click', () => startReplay(record, rows));
      matchesBody.append(tr);
    }
    // Padded to the most any generation has fought, so the panels under it
    // stay put while a generation fills its list in.
    let longest = matches.length;
    for (const generation of run?.generations ?? []) longest = Math.max(longest, generation.matches.length);
    for (let i = matches.length; i < longest; i++) {
      const tr = document.createElement('tr');
      tr.className = 'pad';
      const td = document.createElement('td');
      td.colSpan = 4;
      td.textContent = '\u00a0';
      tr.append(td);
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

    // Mass on the left scale and, once a run fields more than one ship,
    // ships on the right: a colour for each, the mean solid and the best
    // dashed. In a co-evolution run each side takes its team's colours, its
    // hull colour for mass and its trim for ships.
    const sides: { label: string; size: GenerationSize[]; mass: string; ships: string }[] =
      run instanceof Coevolution
        ? [
            { label: 'A ', size: closed.map(sizeOf), mass: teamColour(0), ships: shipColours(0).trim },
            { label: 'B ', size: run.rivalGenerations.map(sizeOf), mass: teamColour(1), ships: shipColours(1).trim },
          ]
        : [{ label: '', size: closed.map(sizeOf), mass: '#7fa8e0', ships: '#e9a35f' }];
    const fleets = sides.some((side) => side.size.some((s) => s.meanShips !== 1));
    type Side = (typeof sides)[number];
    const bestAndMean = (
      what: string,
      colour: (side: Side) => string,
      read: (s: GenerationSize) => [number, number],
      right: boolean,
    ): Series[] =>
      sides.flatMap((side) => {
        if (side.size.length === 0) return [];
        const scale = right ? { right } : {};
        return [
          { name: `${side.label}mean ${what}`, colour: colour(side), values: side.size.map((s) => read(s)[1]), ...scale },
          {
            name: `${side.label}best's ${what}`,
            colour: colour(side),
            values: side.size.map((s) => read(s)[0]),
            dashed: true,
            ...scale,
          },
        ];
      });
    massChart.series = [
      ...bestAndMean('mass', (side) => side.mass, (s) => [s.bestMass / 1000, s.meanMass / 1000], false),
      ...(fleets ? bestAndMean('ships', (side) => side.ships, (s) => [s.bestShips, s.meanShips], true) : []),
    ];
    paintChart();
    showLegend();

    const tops = finalists();
    const top = tops[0] ?? null;
    const co = run instanceof Coevolution;
    saveButton.disabled = top === null;
    exportButton.disabled = top === null;
    // A co-evolution run is measured as a grid of champions rather than
    // against one opponent, which it has no line on a chart to draw against.
    measureButton.disabled = top === null || yardstick !== null || grid !== null;
    watchYardstickButton.disabled = top === null || co;
    benchmarkSelect.disabled = co;
    const describeTop = (each: (typeof tops)[number]): string =>
      `${each.label}#${each.individual.id}, best of generation ${each.generation + 1}: ` +
      `${each.individual.fitness.toFixed(3)} over ${each.individual.matches} matches, ` +
      `${(each.individual.mass / 1000).toFixed(1)} t`;
    championLine.textContent =
      top === null ? '—' : savedAs?.id === top.individual.id ? savedAs.text : tops.map(describeTop).join(' · ');
  };

  /** The run's best: one, or one a side in a co-evolution run, each labelled with its side. */
  const finalists = (): (NonNullable<ReturnType<typeof finalist>> & { label: string })[] => {
    if (run === null) return [];
    const record = run.record();
    if (record.rival === undefined) {
      const top = finalist(record);
      return top === null ? [] : [{ ...top, label: '' }];
    }
    const out: (NonNullable<ReturnType<typeof finalist>> & { label: string })[] = [];
    const a = finalist(record);
    const b = finalist({ config: record.config, generations: record.rival.generations });
    if (a !== null) out.push({ ...a, label: 'A ' });
    if (b !== null) out.push({ ...b, label: 'B ' });
    return out;
  };

  /** The run's best, a side each in a co-evolution run, renamed for the side and generation it came from. */
  const champions = (): { entrant: Entrant; id: number }[] =>
    finalists().map((top) => {
      const entrant = entrantOf(top.individual);
      const side = top.label === '' ? '' : ` ${top.label.trim()}`;
      return { entrant: { ...entrant, name: `${entrant.name}${side} g${top.generation + 1}` }, id: top.individual.id };
    });

  saveButton.addEventListener('click', () => {
    const best = champions();
    if (best.length === 0) return;
    for (const { entrant } of best) {
      if (isFleet(entrant)) fleetLibrary.save(entrant);
      else library.save(entrant);
    }
    // Kept until there is a new best, so the next refresh does not wipe it.
    savedAs = {
      id: best[0]!.id,
      text: `saved as ${best.map(({ entrant }) => `"${entrant.name}"`).join(' and ')} — open ${best.length > 1 ? 'them' : 'it'} in the editor`,
    };
    championLine.textContent = savedAs.text;
  });
  exportButton.addEventListener('click', () => {
    for (const { entrant } of champions()) {
      download(
        `${entrant.name.replace(/[^\w.-]+/g, '_')}.json`,
        isFleet(entrant) ? fleetFileText(entrant) : toFileText(entrant),
      );
    }
  });
  measureButton.addEventListener('click', () => {
    if (run === null || run.generations.length === 0) return;
    const record = run.record();
    if (run instanceof Coevolution) {
      grid = new GridMeasure(record);
      gridResult = null;
      measureButton.disabled = true;
      yardstickLine.textContent = "Fighting each side's champions against the other's…";
      drawGrid();
      return;
    }
    const chosen = benchmarkSelect.value;
    const benchmark = chosen === OWN_FINAL ? latest(record) : load(chosen);
    if (benchmark === null) {
      yardstickLine.textContent = 'Nothing to measure against yet.';
      return;
    }
    // The record rather than a copy of it, so a measurement started while a
    // run is still going carries on into the generations it has not closed
    // yet — the answer is per generation either way.
    measuringAgainst = isFleet(benchmark) ? fleetFileText(benchmark) : toFileText(benchmark);
    const before = measurements.get(measuringAgainst);
    yardstick = new Yardstick(record, benchmark, undefined, before);
    measured = null;
    measureButton.disabled = true;
    yardstickLine.textContent =
      before === undefined
        ? `Measuring against ${benchmark.name}…`
        : `Measuring against ${benchmark.name} from generation ${before.points.length + 1}…`;
  });

  /**
   * Watch the match the measurement fights for one design: the combatant
   * picked in the generation on show, or its best, against the opponent
   * chosen above, on the same seed — so a point on the yardstick line can be
   * looked at rather than taken on trust.
   */
  watchYardstickButton.addEventListener('click', () => {
    if (run === null || run.generations.length === 0) return;
    const record = run.record();
    const chosen = benchmarkSelect.value;
    const benchmark = chosen === OWN_FINAL ? latest(record) : load(chosen);
    if (benchmark === null) return;
    // Only a closed generation is measured, so the one being fought shows the one before it.
    const index = Math.min(showing().index, record.generations.length - 1);
    const individuals = record.generations[index]!.individuals;
    let slot = individuals.findIndex((individual) => individual.id === picked);
    if (slot < 0) {
      slot = 0;
      for (let k = 1; k < individuals.length; k++) {
        if (individuals[k]!.fitness > individuals[slot]!.fitness) slot = k;
      }
    }
    watchReplay(yardstickMatch(record, benchmark, index, slot), null, [individuals[slot]!.id], benchmark.name);
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
    const rivals = chosenVersus();
    run =
      rivals.length > 0
        ? new Coevolution(founders, rivals, readSetup().config, coevolutionSettings())
        : new Run(founders, readSetup().config);
    previewMatch = null;
    previewRows = [];
    savedAs = null;
    notice = '';
    yardstick = null;
    measured = null;
    measurements.clear();
    yardstickLine.textContent = 'Measure once there is something to measure.';
    grid = null;
    gridResult = null;
    drawGrid();
    pictures.clear();
    shown = -1;
    replay = null;
    replayOf = null;
    skipping = false;
    watch(null);
    // The rows, not the table: it is built once and kept.
    for (const { body } of fleetSides) body.replaceChildren();
    fleetTiles.clear();
    fleetScale = 0;
    formationScale = 0;
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

  /**
   * Setting a run up and watching it are two screens: the settings have the
   * width to themselves, beside the founders they would start from, and a
   * run has the width for its charts, combatants and matches.
   */
  const showScreen = (screen: 'setup' | 'run'): void => {
    document.body.classList.toggle('screenSetup', screen === 'setup');
    document.body.classList.toggle('screenRun', screen === 'run');
    toSetupButton.setAttribute('aria-pressed', String(screen === 'setup'));
    toRunButton.setAttribute('aria-pressed', String(screen === 'run'));
    resize();
    refresh();
  };
  toSetupButton.addEventListener('click', () => showScreen('setup'));
  toRunButton.addEventListener('click', () => showScreen('run'));
  startButton.addEventListener('click', () => {
    if (run !== null) {
      toRunButton.disabled = false;
      showScreen('run');
    }
  });

  window.addEventListener('resize', resize);
  resize();
  showScreen('setup');
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
        measurements.set(measuringAgainst, measured);
        yardstick = null;
        // Said before the button comes back, not on the next sample: a button
        // offering another measurement beside a line still saying "measuring"
        // is the page contradicting itself, however briefly.
        reportYardstick();
        measureButton.disabled = false;
      }
    }

    if (grid !== null) {
      const budget = Math.max(1, Math.min(200, number(inputs.effort, 12)));
      const until = performance.now() + budget;
      while (performance.now() < until && grid.advance(240)) {
        // Measuring.
      }
      if (grid.done) {
        gridResult = grid.report();
        grid = null;
        measureButton.disabled = false;
      }
      drawGrid();
    }

    // Nothing on yet is waiting for a run's first match to finish, which a run
    // started with a battle showing always is.
    if (modeSelect.value === 'battle' && (replay === null || (replayPlaying && (replay.done || skipping)))) {
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

    if (
      !fleetBox.hidden &&
      ((fleetScale !== fleetTarget && fleetTarget > 0) ||
        (formationScale !== formationTarget && formationTarget > 0))
    ) {
      if (fleetTarget > 0) fleetScale = easeScale(fleetScale, fleetTarget, FLEET_EASE);
      if (formationTarget > 0) {
        formationScale = easeScale(formationScale, formationTarget, FLEET_EASE);
      }
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

  /**
   * A co-evolution run's champion grid: A's champions down the side, B's
   * across the top, each cell shaded towards the side that came off better
   * and saying how many of its seeds A won.
   */
  function drawGrid(): void {
    const shown = grid?.report() ?? gridResult;
    gridTable.hidden = shown === null;
    if (shown === null) return;
    if (grid === null) {
      yardstickLine.textContent =
        `${shown.matches} matches, ${shown.seeds} a cell. Down a column, later A against the same B; ` +
        'along a row, later B against the same A. An arms race shades towards each side going down and across.';
    } else {
      yardstickLine.textContent = `Fighting each side's champions against the other's, ${(grid.progress * 100).toFixed(0)}%`;
    }
    let most = 0;
    for (const row of shown.cells) for (const cell of row) most = Math.max(most, Math.abs(cell.margin));
    const head = document.createElement('tr');
    const corner = document.createElement('th');
    corner.textContent = 'A↓ B→';
    head.append(corner);
    for (const g of shown.generations) {
      const th = document.createElement('th');
      th.textContent = String(g + 1);
      th.style.color = teamColour(1);
      head.append(th);
    }
    const rows = [head];
    shown.generations.forEach((g, r) => {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.textContent = String(g + 1);
      th.style.color = teamColour(0);
      tr.append(th);
      for (let c = 0; c < shown.generations.length; c++) {
        const td = document.createElement('td');
        const cell = shown.cells[r]?.[c];
        if (cell !== undefined) {
          td.textContent = `${cell.wins}/${shown.seeds}`;
          td.title =
            `A's champion of generation ${g + 1} against B's of generation ${shown.generations[c]! + 1}: ` +
            `won ${cell.wins} of ${shown.seeds}, by ${cell.margin >= 0 ? '+' : ''}${cell.margin.toFixed(3)} on average`;
          const share = most > 0 ? Math.round((Math.abs(cell.margin) / most) * 60) : 0;
          td.style.background = `color-mix(in srgb, ${teamColour(cell.margin >= 0 ? 0 : 1)} ${share}%, transparent)`;
        }
        tr.append(td);
      }
      rows.push(tr);
    });
    gridTable.replaceChildren(...rows);
  }

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

  /**
   * Each side's score in the battle on show, and its parts: what the match
   * would pay if it ended as it stands, so a replay says why it scored what
   * the table says it did.
   */
  function reportScores(): void {
    const match = modeSelect.value === 'battle' ? watchedMatch : null;
    battleScores.hidden = match === null;
    if (match === null) return;
    const names =
      match === replay ? [...replayIds.map((id) => `#${id}`), ...(replayVs === null ? [] : [replayVs])] : [];
    const { slots, owners, ships } = match.battle;
    const table = document.createElement('table');
    const head = document.createElement('tr');
    for (const [css, text, title] of [
      ['', 'side', ''],
      ['', 'score', 'weighted total'],
      ...SCORE_COLUMNS.map((column) => [column.css, column.head, column.title] as const),
    ] as const) {
      const th = document.createElement('th');
      th.className = css;
      th.textContent = text;
      th.title = title;
      head.append(th);
    }
    table.append(head);
    match.result().scores.forEach((score, i) => {
      const tr = document.createElement('tr');
      // In the colour its ships are drawn in: its own, or its side's.
      const k = owners.indexOf(i);
      const colour = teamColour(k < 0 ? i : ships.teamOf(slots[k]!));
      const parts = [score.survival, score.functional, score.damage, score.disabling, score.race];
      for (const cell of [names[i] ?? String(i + 1), score.total.toFixed(3), ...parts.map((part) => part.toFixed(2))]) {
        const td = document.createElement('td');
        td.textContent = cell;
        td.style.color = colour;
        tr.append(td);
      }
      table.append(tr);
    });
    battleScores.replaceChildren(table);
  }

  function report(): void {
    reportYardstick();
    reportScores();
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
    if (run instanceof Coevolution) {
      for (let g = 0; g < run.generations.length; g++) {
        fought += bothSides(run.generations[g]!.matches, run.rivalGenerations[g]?.matches ?? []).length;
      }
      fought += run.done ? 0 : bothSides(run.played, run.rivalPlayed).length;
    } else {
      for (const generation of run.generations) fought += generation.matches.length;
      fought += run.done ? 0 : run.played.length;
    }
    readout.textContent =
      notice !== ''
        ? notice
        : `generation ${Math.min(done + 1, total)} of ${total} · ` +
          `${fought} matches fought · ${(run.progress * 100).toFixed(0)}%`;
    if (modeSelect.value !== 'battle') {
      const shown = showing();
      watchingLabel.textContent = `${shown.rows.length} combatants of generation ${shown.index + 1}`;
    } else if (skipping) {
      watchingLabel.textContent = 'skipped · waiting for the next match';
    } else if (replay !== null) {
      watchingLabel.textContent =
        `${[...replayIds, ...(replayVs === null ? [] : [replayVs])].join(' v ')} · ${(replay.progress * 100).toFixed(0)}%` +
        `${replay.done ? ' · over' : ''}`;
    } else {
      watchingLabel.textContent = 'pick a match from the list';
    }
  }

  window.requestAnimationFrame(tick);
}
