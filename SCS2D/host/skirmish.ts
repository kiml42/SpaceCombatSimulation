import type { Fleet } from '../sim/index.js';
import { teamColour } from '../render/canvas2d.js';
import { FLEET_FILES, Library } from '../editor/library.js';
import { shipFleet } from '../editor/handoff.js';
import { billRows, budgetRows } from '../editor/budget.js';
import { customBattle, DEFAULT_SETUP, tally, type CustomBattle } from '../scenarios/customBattle.js';
import { Activity, type Decision } from '../scenarios/decision.js';
import {
  billOfFleet,
  canFight,
  handedSkirmish,
  lost,
  newSkirmish,
  nextRound,
  parseSkirmish,
  roundBattle,
  roundSetup,
  serialiseSkirmish,
  skirmishFragment,
  SKIRMISH_STORAGE_KEY,
  won,
  type Skirmish,
} from '../scenarios/skirmish.js';
import { startAnswer, type AnswerProgress } from './answer.js';
import { battleView } from './battleView.js';
import { el } from './dom.js';

/**
 * The skirmish page: pick an enemy, fight it a round at a time, and go to the
 * fleet editor and back between tries; win, and watch the enemy evolve an
 * answer, then fight that (ROADMAP.md §8 step 5). The skirmish is kept in
 * browser storage and carried in the link to the editor and back.
 */

const EMPTY = 'empty:';

export function startSkirmish(): void {
  const fleets = new Library(window.localStorage, FLEET_FILES);
  const ships = new Library(window.localStorage);

  const setupPanel = el<HTMLElement>('setup');
  const roundPanel = el<HTMLElement>('round');
  const enemySelect = el<HTMLSelectElement>('enemy');
  const startSelect = el<HTMLSelectElement>('startFleet');
  const answering = el<HTMLElement>('answering');
  const answerProgress = el<HTMLElement>('answerProgress');
  const watchButton = el<HTMLButtonElement>('watchAnswer');
  const playButton = el<HTMLButtonElement>('play');
  const outcome = el<HTMLElement>('outcome');
  const sidesBox = el<HTMLElement>('sides');
  const readout = el<HTMLElement>('readout');
  const editFleet = el<HTMLAnchorElement>('editFleet');

  let skirmish: Skirmish | null = null;
  let battle: CustomBattle | null = null;
  let activity = new Activity(2);
  let decision: Decision | null = null;
  /**
   * What is on the screen: the round, to be won or lost; the best enemy so far
   * fighting the round while the search goes on; or the answer it found.
   */
  let mode: 'round' | 'watching' | 'answer' = 'round';
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

  const view = battleView(
    el<HTMLCanvasElement>('view'),
    (stepped) => {
      if (decision !== null || skirmish === null || stepped !== battle) return;
      decision = activity.observe(stepped);
      if (decision === null) return;
      if (mode === 'round') decided(decision);
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
    },
  );
  el<HTMLButtonElement>('fit').addEventListener('click', () => view.fit());
  const speed = el<HTMLInputElement>('speed');
  speed.addEventListener('input', () => {
    view.setSpeed(Number(speed.value));
    el<HTMLElement>('speedLabel').textContent = `${speed.value}x`;
  });
  playButton.addEventListener('click', () => view.setRunning(!view.running));

  // ---- the setup ------------------------------------------------------------

  /** The enemy alone, to look at while choosing. */
  const preview = (): void => {
    const enemy = read(enemySelect.value);
    el<HTMLElement>('enemyBill').innerHTML = enemy === null ? '' : billRows(billOfFleet(enemy));
    battle = null;
    if (enemy !== null) view.show(enemyAlone(enemy), false);
  };
  const showSetup = (): void => {
    setupPanel.hidden = false;
    roundPanel.hidden = true;
    playButton.disabled = true;
    fillChoices(enemySelect, false);
    fillChoices(startSelect, true);
    preview();
  };
  enemySelect.addEventListener('change', preview);
  el<HTMLButtonElement>('start').addEventListener('click', () => {
    const enemy = read(enemySelect.value);
    if (enemy === null) return;
    const player = startSelect.value === EMPTY ? { name: 'My fleet', designs: {}, ships: [] } : read(startSelect.value);
    if (player === null) return;
    // The page's own randomness, not the battle's: it only picks which battle.
    skirmish = newSkirmish(enemy, player, Math.floor(Math.random() * 2 ** 32));
    save();
    // Nothing to fight with yet: straight to the editor to build it.
    if (player.ships.length === 0) window.location.href = `fleet.html${skirmishFragment(skirmish)}`;
    else showRound();
  });

  // ---- a round --------------------------------------------------------------

  const showRound = (): void => {
    if (skirmish === null) return;
    setupPanel.hidden = true;
    roundPanel.hidden = false;
    answering.hidden = true;
    mode = 'round';
    outcome.textContent = '';
    outcome.className = '';
    decision = null;
    activity = new Activity(2);
    el<HTMLElement>('roundTitle').textContent =
      `Round ${skirmish.round}` + (skirmish.tries > 0 ? ` · try ${skirmish.tries + 1}` : '');
    el<HTMLElement>('enemyName').textContent = `Against ${skirmish.enemy.name}.`;
    el<HTMLElement>('playerName').textContent = skirmish.player.name;
    el<HTMLElement>('budget').innerHTML = budgetRows(billOfFleet(skirmish.player), skirmish.budget);
    const fits = canFight(skirmish);
    el<HTMLElement>('fleetNote').textContent = fits
      ? ''
      : skirmish.player.ships.length === 0
        ? 'Your fleet has no ships: edit it to add some.'
        : 'Your fleet is over budget: edit it to cut it down.';
    playButton.disabled = !fits;
    el<HTMLButtonElement>('retry').disabled = !fits;
    editFleet.hidden = false;
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
    const at = `at ${result.time.toFixed(0)} s`;
    if (result.winner === 0) {
      outcome.textContent = `Victory ${at}. The enemy evolves an answer.`;
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
    }
  };

  el<HTMLButtonElement>('retry').addEventListener('click', () => {
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
    el<HTMLButtonElement>('retry').disabled = true;
    editFleet.hidden = true;
    watchButton.hidden = false;
    answerProgress.textContent = 'Fighting the first generation of mutants…';
    latest = null;
    stopSearch?.();
    stopSearch = startAnswer(
      { player: skirmish.player, enemy: skirmish.enemy, won: skirmish.won, seed: (skirmish.won ^ skirmish.round) >>> 0 },
      progressed,
    );
  };

  const progressed = (now: AnswerProgress): void => {
    if (skirmish === null) return;
    latest = now;
    // Kept as it goes, so a reload carries on from the best so far.
    skirmish = { ...skirmish, enemy: now.found ?? now.best };
    save();
    if (now.found !== null) {
      stopSearch?.();
      stopSearch = null;
      found(now.found, now.generation);
      return;
    }
    answerProgress.textContent =
      `Generation ${now.generation}: the best enemy so far won ${now.wins} of its ${now.seeds} matches.`;
    // The first best, or the last replay over: show the newest.
    if (mode !== 'watching' || decision !== null) watch(now);
  };

  /** Show the best enemy so far fighting the round, if the player is watching. */
  const watch = (now: AnswerProgress): void => {
    if (skirmish === null || skirmish.won === undefined || !watching) return;
    mode = 'watching';
    decision = null;
    activity = new Activity(2);
    battle = customBattle(roundBattle(skirmish.player, now.best, skirmish.won));
    outcome.textContent = `Generation ${now.generation}'s best enemy against your fleet.`;
    outcome.className = '';
    el<HTMLElement>('enemyName').textContent = `Against ${now.best.name}, evolving.`;
    playButton.disabled = false;
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
    mode = 'answer';
    decision = null;
    activity = new Activity(2);
    answerProgress.textContent = `Found in generation ${generation}: ${enemy.name}, on the seed you won on.`;
    watchButton.hidden = true;
    el<HTMLElement>('answered').hidden = false;
    battle = customBattle(roundBattle(skirmish.player, enemy, skirmish.won));
    outcome.textContent = "The enemy's answer.";
    outcome.className = 'lost';
    el<HTMLElement>('enemyName').textContent = `Against ${enemy.name}, the answer.`;
    playButton.disabled = false;
    view.show(battle, true);
  };

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
  if (window.location.hash !== '') history.replaceState(null, '', window.location.pathname);
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
