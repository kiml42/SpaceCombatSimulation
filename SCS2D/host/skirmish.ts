import { serialiseFleet, type Budget, type Fleet } from '../sim/index.js';
import { teamColour } from '../render/canvas2d.js';
import { FLEET_FILES, Library, unusedName } from '../editor/library.js';
import { shipFleet } from '../editor/handoff.js';
import { billRows, budgetRows } from '../editor/budget.js';
import { customBattle, DEFAULT_SETUP, tally, type CustomBattle } from '../scenarios/customBattle.js';
import { Activity, type Decision } from '../scenarios/decision.js';
import {
  billOfFleet,
  canFight,
  fleetFault,
  handedSkirmish,
  lost,
  newSkirmish,
  enemyMultiplier,
  overLimit,
  nextRound,
  parseSkirmish,
  parseSkirmishSettings,
  roundBattle,
  roundSetup,
  serialiseSkirmish,
  settingsOf,
  skirmishFragment,
  SKIRMISH_STORAGE_KEY,
  DEFAULT_SKIRMISH_SETTINGS,
  won,
  type Skirmish,
  type SkirmishSettings,
} from '../scenarios/skirmish.js';
import { MUTATION_FIELDS } from '../evolution/mutationFields.js';
import { fillFields, type SettingField } from './settingsFields.js';
import {
  dropOldest,
  EMPTY_HISTORY,
  HISTORY_STORAGE_KEY,
  parseHistory,
  record,
  type History,
  type Played,
} from '../scenarios/history.js';
import { startAnswer, type AnswerProgress } from './answer.js';
import { timeline } from './timeline.js';
import { battleView } from './battleView.js';
import { el } from './dom.js';

/**
 * The skirmish page: pick an enemy, fight it a round at a time, and go to the
 * fleet editor and back between tries; win, and watch the enemy evolve an
 * answer, then fight that (ROADMAP.md §8 step 5). The skirmish is kept in
 * browser storage and carried in the link to the editor and back.
 */

const EMPTY = 'empty:';

/** The settings a new skirmish starts with, kept as last chosen. */
const SETTINGS_KEY = 'scs2d.skirmish.settings';

const D = DEFAULT_SKIRMISH_SETTINGS;
/** The round's settings and the answer's, as the setup screen offers them. */
const SKIRMISH_FIELDS: readonly SettingField[] = [
  { name: 'maxShips', group: 'limits', label: 'most ships', step: 1, min: 1, value: D.maxShips,
    title: "The most ships either side may field, unless the enemy already has more: a limit on how hard a battle works the computer." },
  { name: 'radius', group: 'limits', label: 'spawn radius m', step: 50, min: 1, value: D.radius,
    title: "How far from its origin any of either side's hulls may reach, unless the enemy already reaches further." },
  { name: 'quietTime', group: 'round', label: 'quiet s', step: 5, min: 1, value: D.quietTime,
    title: 'Once both sides have fired, a side that has not fired, hit or rammed for this long, while the other has, is out of the battle.' },
  { name: 'timeCap', group: 'round', label: 'time cap s', step: 30, min: 1, value: D.timeCap,
    title: 'A battle not decided by then is a draw, which is a loss for you.' },
  { name: 'gap', group: 'round', label: 'gap m', step: 100, value: D.gap,
    title: "Clear water between the two fleets' furthest hulls at the start." },
  { name: 'closingSpeed', group: 'round', label: 'closing m/s', step: 5, min: null, value: D.closingSpeed,
    title: 'Each fleet\'s starting speed towards the other.' },
  { name: 'crossingSpeed', group: 'round', label: 'crossing m/s', step: 5, min: null, value: D.crossingSpeed,
    title: 'Each fleet\'s starting speed across the line between them, to its left.' },
  { name: 'gapSpread', group: 'round', spreadOf: 'gap', label: '', step: 100, value: D.gapSpread,
    title: "How far either side each round's gap is drawn, evenly. Zero holds it." },
  { name: 'closingSpread', group: 'round', spreadOf: 'closingSpeed', label: '', step: 5, value: D.closingSpread,
    title: "How far either side each round's closing speed is drawn, evenly. Zero holds it." },
  { name: 'crossingSpread', group: 'round', spreadOf: 'crossingSpeed', label: '', step: 5, value: D.crossingSpread,
    title: "How far either side each round's crossing speed is drawn, evenly. Zero holds it." },
  { name: 'mutants', group: 'answer', label: 'mutants', step: 1, min: 1, value: D.mutants,
    title: 'Mutants of the enemy a generation, beside the best so far.' },
  { name: 'seeds', group: 'answer', label: 'matches each', step: 1, min: 1, value: D.seeds,
    title: "Matches each enemy fights a generation, on different seeds, the next round's among them, so it cannot win by a fluke of one." },
  { name: 'duration', group: 'answer', label: 'match s', step: 30, min: 1, value: D.duration,
    title: 'How long a match of the search lasts before the side ahead is taken to win.' },
  { name: 'bareCoreDrills', group: 'answer', label: 'bare core drills', step: 1, value: D.bareCoreDrills,
    title: 'Matches each enemy fights a generation against a bare core, scored on how much of it, and how soon, it destroys. They only add to its score: it learns to hit something.' },
  { name: 'shieldedDrills', group: 'answer', label: 'invincible drills', step: 1, value: D.shieldedDrills,
    title: 'Matches each enemy fights a generation against your fleet with itself made invincible, scored on how much of your fleet it destroys and how soon it leaves it nothing to fire. They only add to its score: it learns to hurt you before you strip it.' },
  { name: 'budgetStep', group: 'answer', label: 'budget step', step: 0.05, value: D.budgetStep,
    title: "What is added to the enemy's budget, as a multiple of yours, each time its search stalls. It starts at 1×, or what the enemy already costs if more, and never falls." },
  { name: 'stretchAfter', group: 'answer', label: 'step up after', step: 1, min: 1, value: D.stretchAfter,
    title: "Generations without an answer before the enemy's budget steps up again." },
];
/** Those that are counts, and so whole. */
const WHOLE = new Set(['mutants', 'seeds', 'stretchAfter', 'maxShips', 'bareCoreDrills', 'shieldedDrills']);

export function startSkirmish(): void {
  const fleets = new Library(window.localStorage, FLEET_FILES);
  const ships = new Library(window.localStorage);

  fillFields(document, [...SKIRMISH_FIELDS, ...MUTATION_FIELDS]);
  const settingInputs = new Map([...SKIRMISH_FIELDS, ...MUTATION_FIELDS].map((f) => [f.name, el<HTMLInputElement>(f.name)]));
  const roundPanel = el<HTMLElement>('round');
  const enemySelect = el<HTMLSelectElement>('enemy');
  const startSelect = el<HTMLSelectElement>('startFleet');
  const answering = el<HTMLElement>('answering');
  const answerProgress = el<HTMLElement>('answerProgress');
  const watchButton = el<HTMLButtonElement>('watchAnswer');
  const playButton = el<HTMLButtonElement>('play');
  // The round's own Fight, where the rest of the round is; the header's stays for any battle shown.
  const fightButton = el<HTMLButtonElement>('fight');
  const retryButton = el<HTMLButtonElement>('retry');
  const outcome = el<HTMLElement>('outcome');
  const sidesBox = el<HTMLElement>('sides');
  const readout = el<HTMLElement>('readout');
  const editFleet = el<HTMLAnchorElement>('editFleet');
  const times = (m: number): string => `${Number(m.toFixed(3))}×`;
  /** How big an enemy the player is holding off: its budget against theirs. */
  const showMultiplier = (m: number): void => {
    el<HTMLElement>('multiplier').textContent = `Playing against a ${times(m)} enemy: its budget is ${times(m)} yours.`;
  };
  /** Mark the one thing to press next in the round's buttons, or none. */
  const cta = (next: HTMLElement | null): void => {
    for (const button of [fightButton, editFleet, retryButton]) button.classList.toggle('primary', button === next);
  };
  const fightLabel = el<HTMLElement>('fightLabel');
  const fightSpinner = el<HTMLElement>('fightSpinner');
  let canFightNow = false;
  const playable = (can: boolean): void => {
    playButton.disabled = !can;
    canFightNow = can;
    showFight(false);
  };
  /** The round's Fight starts it and then waits on it; pausing is the header's. */
  const showFight = (running: boolean): void => {
    fightLabel.textContent = running ? 'Fighting…' : (battle?.world.tick ?? 0) > 0 ? 'Resume' : 'Fight';
    fightSpinner.hidden = !running;
    fightButton.classList.toggle('running', running);
    fightButton.disabled = running || !canFightNow;
  };

  let skirmish: Skirmish | null = null;
  let battle: CustomBattle | null = null;
  let activity = new Activity(2);
  let decision: Decision | null = null;
  /** A fresh decision rule for a battle of the skirmish, under its settings. */
  const newActivity = (): Activity => {
    const settings = skirmish === null ? DEFAULT_SKIRMISH_SETTINGS : settingsOf(skirmish);
    return new Activity(2, settings.timeCap, settings.quietTime);
  };
  /**
   * What is on the screen: the round, to be won or lost; the best enemy so far
   * fighting the round while the search goes on; or the answer it found.
   */
  let mode: 'round' | 'watching' | 'answer' | 'replay' = 'round';
  /** Where *Back to the round* goes from a match being watched again. */
  let resume: (() => void) | null = null;
  let stopSearch: (() => void) | null = null;
  let watching = true;
  let latest: AnswerProgress | null = null;

  /** A fleet, or a single ship as a fleet of one, from a list value. */
  const read = (value: string): Fleet | null => {
    const [kind, ...rest] = value.split(':');
    const name = rest.join(':');
    try {
      if (kind === 'fleet') return fleets.load(name);
      if (kind === 'ship') {
        const blueprint = ships.load(name);
        return blueprint === null ? null : shipFleet(blueprint);
      }
    } catch (error) {
      window.alert(`Could not read ${name}.\n\n${error instanceof Error ? error.message : error}`);
    }
    return null;
  };
  const fillChoices = (select: HTMLSelectElement, empty: boolean): void => {
    const keep = select.value;
    select.innerHTML = '';
    if (empty) select.append(new Option('An empty fleet, to build', EMPTY));
    const group = (label: string, kind: string, names: readonly string[]): void => {
      const box = document.createElement('optgroup');
      box.label = label;
      for (const name of names) box.append(new Option(name, `${kind}:${name}`));
      select.append(box);
    };
    group('Fleets', 'fleet', [...new Set(fleets.list().map((entry) => entry.name))]);
    group('Single ships', 'ship', [...new Set(ships.list().map((entry) => entry.name))]);
    if (keep !== '' && [...select.options].some((option) => option.value === keep)) select.value = keep;
  };

  const save = (): void => {
    if (skirmish === null) return;
    try {
      window.localStorage.setItem(SKIRMISH_STORAGE_KEY, JSON.stringify(serialiseSkirmish(skirmish)));
    } catch {
      // Storage full or refused: the skirmish lasts as long as the page.
    }
  };

  // ---- the history ----------------------------------------------------------

  let history: History = EMPTY_HISTORY;
  try {
    const kept = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    if (kept !== null) history = parseHistory(JSON.parse(kept));
  } catch {
    // Unreadable: start it again.
  }
  /** Kept in storage, letting go of the oldest runs' fleets until it fits. */
  const keepHistory = (): void => {
    for (;;) {
      try {
        window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
        return;
      } catch {
        const smaller = dropOldest(history);
        if (smaller === null) return;
        history = smaller;
      }
    }
  };
  const recordMatch = (played: Played): void => {
    history = record(history, played);
    keepHistory();
    line.show(history);
  };
  const line = timeline(el<HTMLElement>('timeline'), {
    watch: (row, player, enemy) => replay(row.round, row.seed, player, enemy),
    save: (fleet) => {
      const name = unusedName(fleet.name, fleets.savedNames());
      fleets.save({ ...fleet, name });
      window.alert(`Saved to your fleets as ${name}.`);
    },
    exportFleet: (fleet) => {
      const text = `${JSON.stringify(serialiseFleet(fleet), null, 2)}\n`;
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${fleet.name}.fleet.json`;
      link.click();
      URL.revokeObjectURL(url);
    },
  });

  const view = battleView(
    el<HTMLCanvasElement>('view'),
    (stepped) => {
      if (decision !== null || skirmish === null || stepped !== battle) return;
      decision = activity.observe(stepped);
      if (decision === null) return;
      if (mode === 'round') decided(decision);
      else if (mode === 'replay') outcome.textContent = replayOutcome(decision);
      else if (mode === 'answer') outcome.textContent = `The enemy's answer beats your fleet at ${decision.time.toFixed(0)} s.`;
      // Watching, a replay that is over gives way to the next best enemy.
      else if (latest !== null) watch(latest);
    },
    (drawn) => {
      readout.textContent = skirmish === null ? '' : `round ${skirmish.round} · t ${drawn.time.toFixed(1)} s`;
      if (battle !== null && roundPanel.hidden === false) renderSides(battle, drawn.time);
    },
    (running) => {
      playButton.textContent = running ? 'Pause' : decision !== null || (battle?.world.tick ?? 0) > 0 ? 'Resume' : 'Fight';
      showFight(running);
    },
  );
  el<HTMLButtonElement>('fit').addEventListener('click', () => view.fit());
  el<HTMLButtonElement>('exportSkirmish').addEventListener('click', () => {
    const file = {
      about:
        'A skirmish exported from the Skirmish page: the settings on the setup screen, the skirmish under way ' +
        '(round, budget, both fleets and the settings it started with) if there is one, and the history of every ' +
        'match played, its fleets kept by id.',
      setup: readSettings(),
      skirmish: skirmish === null ? null : serialiseSkirmish(skirmish),
      history,
    };
    const name = skirmish === null ? 'skirmish' : `skirmish-round-${skirmish.round}`;
    const url = URL.createObjectURL(new Blob([`${JSON.stringify(file, null, 2)}\n`], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${name}.skirmish.json`;
    link.click();
    URL.revokeObjectURL(url);
  });
  const speed = el<HTMLSelectElement>('speed');
  view.keep('skirmish', speed);
  speed.addEventListener('change', () => view.setSpeed(Number(speed.value)));
  playButton.addEventListener('click', () => view.setRunning(!view.running));
  fightButton.addEventListener('click', () => view.setRunning(true));

  // ---- the setup ------------------------------------------------------------

  // The budget boxes in tonnes and hours, as a big fleet's bill reads.
  const BUDGET_UNITS: Record<keyof Budget, number> = { metal: 1000, fuel: 1000, build: 3600 };
  const budgetInput = (key: keyof Budget): HTMLInputElement => el<HTMLInputElement>(`${key}Budget`);
  /** What the enemy cost, exactly, behind boxes showing it rounded. */
  let enemyCost: Budget | null = null;
  /** Set the boxes to the enemy's cost: every one, or only those the player has left following it. */
  const matchEnemy = (all = true): void => {
    for (const key of Object.keys(BUDGET_UNITS) as (keyof Budget)[]) {
      const input = budgetInput(key);
      const following = input.value.trim() === '' || input.value === input.dataset['shown'];
      if (!all && !following) continue;
      input.value = enemyCost === null ? '' : String(Math.round((enemyCost[key] / BUDGET_UNITS[key]) * 100) / 100);
      input.dataset['shown'] = input.value;
    }
  };
  /** The budget the boxes say: one left as the enemy's cost is that cost exactly, and one blank or unreadable too. */
  const readBudget = (cost: Budget): Budget => {
    const out = { ...cost };
    for (const key of Object.keys(BUDGET_UNITS) as (keyof Budget)[]) {
      const input = budgetInput(key);
      const raw = input.value.trim();
      const n = raw === '' ? NaN : Number(raw);
      if (raw !== input.dataset['shown'] && Number.isFinite(n)) out[key] = Math.max(0, n) * BUDGET_UNITS[key];
    }
    return out;
  };
  el<HTMLButtonElement>('matchEnemy').addEventListener('click', () => matchEnemy());

  /** The enemy alone, to look at while choosing, its cost the budget where the player has not set one. */
  const preview = (): void => {
    const enemy = read(enemySelect.value);
    const flies = enemy !== null && fleetFault(enemy) === null;
    enemyCost = flies ? billOfFleet(enemy) : null;
    el<HTMLElement>('enemyBill').innerHTML = enemyCost !== null ? billRows(enemyCost) : '';
    // A box the player has set stays as they set it.
    matchEnemy(false);
    battle = null;
    if (flies) view.show(enemyAlone(enemy), false);
  };
  const showSetup = (): void => {
    el<HTMLElement>('history').hidden = true;
    document.body.classList.add('screenSetup');
    roundPanel.hidden = true;
    playable(false);
    fillChoices(enemySelect, false);
    fillChoices(startSelect, true);
    preview();
  };
  enemySelect.addEventListener('change', preview);

  /** What the setup screen says, as settings: a box left blank or unreadable is its default. */
  const readSettings = (): SkirmishSettings => {
    const value = (name: string, fallback: number, least: number | null): number => {
      const raw = settingInputs.get(name)!.value.trim();
      const n = raw === '' ? NaN : Number(raw);
      if (!Number.isFinite(n)) return fallback;
      const whole = WHOLE.has(name) ? Math.round(n) : n;
      return least !== null && whole < least ? least : whole;
    };
    const out: Record<string, unknown> = {};
    for (const field of SKIRMISH_FIELDS) out[field.name] = value(field.name, field.value, field.min === undefined ? 0 : field.min);
    const breeding: Record<string, number> = {};
    for (const field of MUTATION_FIELDS) breeding[field.name] = value(field.name, field.value, 0);
    return { ...DEFAULT_SKIRMISH_SETTINGS, ...out, breeding };
  };
  /** Fill the setup screen from settings. */
  const showSettings = (settings: SkirmishSettings): void => {
    for (const field of SKIRMISH_FIELDS) settingInputs.get(field.name)!.value = String(settings[field.name as keyof SkirmishSettings]);
    for (const field of MUTATION_FIELDS) settingInputs.get(field.name)!.value = String(settings.breeding[field.name] ?? field.value);
  };
  const keepSettings = (): void => {
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(readSettings()));
    } catch {
      // Storage full or refused: they last as long as the page.
    }
  };
  let kept: SkirmishSettings = DEFAULT_SKIRMISH_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (raw !== null) kept = parseSkirmishSettings(JSON.parse(raw));
  } catch {
    // Unreadable: the defaults.
  }
  showSettings(kept);
  for (const input of settingInputs.values()) input.addEventListener('change', keepSettings);
  el<HTMLButtonElement>('resetSettings').addEventListener('click', () => {
    showSettings(DEFAULT_SKIRMISH_SETTINGS);
    keepSettings();
    matchEnemy();
  });
  el<HTMLButtonElement>('start').addEventListener('click', () => {
    const enemy = read(enemySelect.value);
    if (enemy === null) return;
    const enemyFault = fleetFault(enemy);
    if (enemyFault !== null) {
      window.alert(`That enemy would not fly: ${enemyFault}`);
      return;
    }
    const player = startSelect.value === EMPTY ? { name: 'My fleet', designs: {}, ships: [] } : read(startSelect.value);
    if (player === null) return;
    // The page's own randomness, not the battle's: it only picks which battle.
    skirmish = newSkirmish(enemy, player, Math.floor(Math.random() * 2 ** 32), readSettings(), readBudget(billOfFleet(enemy)));
    save();
    // Nothing to fight with yet: straight to the editor to build it.
    if (player.ships.length === 0) window.location.href = `fleet.html${skirmishFragment(skirmish)}`;
    else showRound();
  });

  // ---- a round --------------------------------------------------------------

  const showRound = (): void => {
    if (skirmish === null) return;
    document.body.classList.remove('screenSetup');
    roundPanel.hidden = false;
    el<HTMLElement>('history').hidden = false;
    el<HTMLElement>('replaying').hidden = true;
    line.show(history);
    answering.hidden = true;
    mode = 'round';
    outcome.textContent = '';
    outcome.className = '';
    decision = null;
    activity = newActivity();
    el<HTMLElement>('roundTitle').textContent =
      `Round ${skirmish.round}` + (skirmish.tries > 0 ? ` · try ${skirmish.tries + 1}` : '');
    el<HTMLElement>('enemyName').textContent = `Against ${skirmish.enemy.name}.`;
    showMultiplier(enemyMultiplier(skirmish));
    el<HTMLElement>('playerName').textContent = skirmish.player.name;
    const fault = fleetFault(skirmish.player);
    el<HTMLElement>('budget').innerHTML = fault !== null ? '' : budgetRows(billOfFleet(skirmish.player), skirmish.budget);
    const fits = canFight(skirmish);
    const limit = fault === null ? overLimit(skirmish) : null;
    el<HTMLElement>('fleetNote').textContent = fits
      ? ''
      : skirmish.player.ships.length === 0
        ? 'Your fleet has no ships: edit it to add some.'
        : fault !== null
          ? `Your fleet would not fly: ${fault}. Edit it to fix that.`
          : limit !== null
            ? `Your fleet has ${limit}: edit it to fit.`
            : 'Your fleet is over budget: edit it to cut it down.';
    playable(fits);
    retryButton.disabled = !fits;
    retryButton.hidden = false;
    editFleet.hidden = false;
    fightButton.hidden = false;
    cta(fits ? fightButton : editFleet);
    if (fits) {
      battle = customBattle(roundSetup(skirmish));
      view.show(battle, false);
    } else {
      battle = null;
      view.show(enemyAlone(skirmish.enemy), false);
    }
  };

  const decided = (result: Decision): void => {
    if (skirmish === null) return;
    recordMatch({
      kind: 'try',
      round: skirmish.round,
      seed: skirmish.seed,
      winner: result.winner,
      player: skirmish.player,
      enemy: skirmish.enemy,
    });
    // The round is over: Restart fights it again.
    fightButton.hidden = true;
    const at = `at ${result.time.toFixed(0)} s`;
    if (result.winner === 0) {
      outcome.textContent = `Victory ${at}. Wait while the enemy evolves an answer.`;
      outcome.className = 'won';
      skirmish = won(skirmish);
      save();
      answer();
    } else {
      outcome.textContent =
        result.winner < 0
          ? result.reason === 'time'
            ? `Stalemate ${at}: a draw is a loss. Edit your fleet and try again.`
            : `Neither side can fight on ${at}: a draw is a loss. Edit your fleet and try again.`
          : `Defeat ${at}. Edit your fleet and try again.`;
      outcome.className = 'lost';
      skirmish = lost(skirmish);
      save();
      cta(editFleet);
    }
  };

  retryButton.addEventListener('click', () => {
    showRound();
    view.setRunning(true);
  });
  editFleet.addEventListener('click', () => {
    if (skirmish !== null) editFleet.href = `fleet.html${skirmishFragment(skirmish)}`;
  });
  // ---- the enemy's answer ---------------------------------------------------

  /** Set the search going against the player's fleet, from the enemy as it stands. */
  const answer = (): void => {
    if (skirmish === null || skirmish.won === undefined) return;
    answering.hidden = false;
    el<HTMLElement>('answered').hidden = true;
    retryButton.hidden = true;
    editFleet.hidden = true;
    fightButton.hidden = true;
    cta(null);
    el<HTMLElement>('answerSpinner').hidden = false;
    watchButton.hidden = false;
    answerProgress.textContent = 'Wait while the enemy evolves an answer: fighting the first generation of mutants…';
    latest = null;
    stopSearch?.();
    stopSearch = startAnswer(
      {
        player: skirmish.player,
        enemy: skirmish.enemy,
        won: skirmish.won,
        seed: (skirmish.won ^ skirmish.round) >>> 0,
        settings: settingsOf(skirmish),
        budget: skirmish.budget,
        multiplier: enemyMultiplier(skirmish),
      },
      progressed,
    );
  };

  const progressed = (now: AnswerProgress): void => {
    if (skirmish === null) return;
    latest = now;
    // Kept as it goes, so a reload carries on from the best so far, at the budget reached.
    skirmish = { ...skirmish, enemy: now.found ?? now.best, multiplier: now.multiplier };
    showMultiplier(now.multiplier);
    save();
    if (now.found !== null) {
      stopSearch?.();
      stopSearch = null;
      recordMatch({ kind: 'answer', round: skirmish.round, seed: skirmish.won!, winner: 1, player: skirmish.player, enemy: now.found });
      found(now.found, now.generation);
      return;
    }
    recordMatch({
      kind: 'search',
      round: skirmish.round,
      seed: skirmish.won!,
      winner: now.onRound ? 1 : 0,
      player: skirmish.player,
      enemy: now.best,
      generation: now.generation,
    });
    answerProgress.textContent =
      `Generation ${now.generation}: the best enemy so far won ${now.wins} of its ${now.seeds} matches. ` +
      `It may spend ${times(now.multiplier)} your budget.`;
    // The first best, or the last replay over: show the newest. Not over a match watched again.
    if (mode === 'replay') return;
    if (mode !== 'watching' || decision !== null) watch(now);
  };

  /** Show the best enemy so far fighting the round, if the player is watching. */
  const watch = (now: AnswerProgress): void => {
    if (skirmish === null || skirmish.won === undefined || !watching) return;
    mode = 'watching';
    decision = null;
    activity = newActivity();
    battle = customBattle(roundBattle(skirmish.player, now.best, skirmish.won, settingsOf(skirmish)));
    outcome.textContent = `Generation ${now.generation}'s best enemy against your fleet.`;
    outcome.className = '';
    el<HTMLElement>('enemyName').textContent = `Against ${now.best.name}, evolving.`;
    playable(true);
    view.show(battle, true);
  };
  watchButton.addEventListener('click', () => {
    watching = !watching;
    watchButton.textContent = watching ? 'Stop watching' : 'Watch';
    if (watching && latest !== null) watch(latest);
    else if (!watching) view.setRunning(false);
  });

  const found = (enemy: Fleet, generation: number): void => {
    if (skirmish === null || skirmish.won === undefined) return;
    answerProgress.textContent = `Found in generation ${generation}: ${enemy.name}, which beats your fleet on the next round's seed.`;
    el<HTMLElement>('answerSpinner').hidden = true;
    watchButton.hidden = true;
    el<HTMLElement>('answered').hidden = false;
    if (mode === 'replay') {
      resume = () => showAnswer(enemy);
      return;
    }
    showAnswer(enemy);
  };

  const showAnswer = (enemy: Fleet): void => {
    if (skirmish === null || skirmish.won === undefined) return;
    mode = 'answer';
    decision = null;
    activity = newActivity();
    battle = customBattle(roundBattle(skirmish.player, enemy, skirmish.won, settingsOf(skirmish)));
    outcome.textContent = "The enemy's answer.";
    outcome.className = 'lost';
    el<HTMLElement>('enemyName').textContent = `Against ${enemy.name}, the answer.`;
    playable(true);
    view.show(battle, true);
  };

  // ---- a match watched again -------------------------------------------------

  const replaying = el<HTMLElement>('replaying');
  /** Fight a match of the history again on the battle view, and come back to where things were. */
  const replay = (round: number, seed: number, player: Fleet, enemy: Fleet): void => {
    if (mode !== 'replay') {
      const was = mode;
      const latestThen = latest;
      resume =
        was === 'round'
          ? showRound
          : was === 'answer'
            ? () => skirmish !== null && showAnswer(skirmish.enemy)
            : () => {
                mode = 'watching';
                if (latest ?? latestThen) watch((latest ?? latestThen)!);
              };
    }
    mode = 'replay';
    fightButton.hidden = true;
    decision = null;
    activity = newActivity();
    battle = customBattle(roundBattle(player, enemy, seed, skirmish === null ? DEFAULT_SKIRMISH_SETTINGS : settingsOf(skirmish)));
    outcome.textContent = `Round ${round}, again.`;
    outcome.className = '';
    playable(true);
    replaying.hidden = false;
    view.show(battle, true);
  };
  const replayOutcome = (result: Decision): string =>
    result.winner === 0
      ? `You won this one at ${result.time.toFixed(0)} s.`
      : result.winner === 1
        ? `The enemy won this one at ${result.time.toFixed(0)} s.`
        : `A draw at ${result.time.toFixed(0)} s.`;
  el<HTMLButtonElement>('backToRound').addEventListener('click', () => {
    replaying.hidden = true;
    const back = resume;
    resume = null;
    // Somewhere other than a replay, or the round anew.
    mode = 'round';
    (back ?? showRound)();
  });

  el<HTMLButtonElement>('nextRound').addEventListener('click', () => {
    if (skirmish === null) return;
    skirmish = nextRound(skirmish, skirmish.enemy);
    save();
    showRound();
  });
  el<HTMLButtonElement>('abandon').addEventListener('click', () => {
    if (!window.confirm('Give up this skirmish and start another?')) return;
    stopSearch?.();
    stopSearch = null;
    try {
      window.localStorage.removeItem(SKIRMISH_STORAGE_KEY);
    } catch {
      // Nothing kept to forget.
    }
    skirmish = null;
    history = EMPTY_HISTORY;
    try {
      window.localStorage.removeItem(HISTORY_STORAGE_KEY);
    } catch {
      // Nothing kept to forget.
    }
    showSetup();
  });

  let lastSides = -Infinity;
  const renderSides = (shown: CustomBattle, time: number): void => {
    // A table to read, not an animation: a few times a simulated second.
    if (time - lastSides < 0.2 && time >= lastSides) return;
    lastSides = time;
    const now = tally(shown, 2);
    sidesBox.innerHTML = shown.start
      .map((start, i) => {
        const side = now[i]!;
        const lostShare = start.mass > 0 ? (1 - side.mass / start.mass) * 100 : 0;
        const name = i === 0 ? 'You' : (shown.setup.fleets[i]?.name ?? 'Enemy');
        return (
          `<div class="side"><span class="swatch" style="background:${teamColour(i)}"></span>${escapeHtml(name)}</div>` +
          `<div class="sideStats">${side.ships}/${start.ships} ships · ${side.armed} armed · ${Math.round(lostShare)}% of mass lost</div>`
        );
      })
      .join('');
  };

  // The editor hands the skirmish back in the link; otherwise pick up the one kept.
  try {
    skirmish = handedSkirmish(window.location.hash);
  } catch (error) {
    window.alert(`Could not read the skirmish handed over.\n\n${error instanceof Error ? error.message : error}`);
  }
  if (window.location.hash !== '') window.history.replaceState(null, '', window.location.pathname);
  if (skirmish === null) {
    try {
      const kept = window.localStorage.getItem(SKIRMISH_STORAGE_KEY);
      if (kept !== null) skirmish = parseSkirmish(JSON.parse(kept));
    } catch {
      // Unreadable: start a new one.
      skirmish = null;
    }
  }
  if (skirmish === null) showSetup();
  else {
    save();
    showRound();
    // Left while the enemy was answering: carry on from the best so far.
    if (skirmish.won !== undefined) answer();
  }
}

/** The enemy where it will stand, in its colour, with nobody yet on the other side. */
function enemyAlone(enemy: Fleet): CustomBattle {
  return customBattle({ ...DEFAULT_SETUP, fleets: [{ name: '', designs: {}, ships: [] }, enemy] });
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}
