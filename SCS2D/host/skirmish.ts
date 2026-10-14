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
  roundSetup,
  serialiseSkirmish,
  skirmishFragment,
  SKIRMISH_STORAGE_KEY,
  type Skirmish,
} from '../scenarios/skirmish.js';
import { battleView } from './battleView.js';
import { el } from './dom.js';

/**
 * The skirmish page: pick an enemy, fight it a round at a time, and go to the
 * fleet editor and back between tries (ROADMAP.md §8 step 5). The skirmish is
 * kept in browser storage and carried in the link to the editor and back.
 */

const EMPTY = 'empty:';

export function startSkirmish(): void {
  const fleets = new Library(window.localStorage, FLEET_FILES);
  const ships = new Library(window.localStorage);

  const setupPanel = el<HTMLElement>('setup');
  const roundPanel = el<HTMLElement>('round');
  const enemySelect = el<HTMLSelectElement>('enemy');
  const startSelect = el<HTMLSelectElement>('startFleet');
  const nextPanel = el<HTMLElement>('next');
  const nextSelect = el<HTMLSelectElement>('nextEnemy');
  const playButton = el<HTMLButtonElement>('play');
  const outcome = el<HTMLElement>('outcome');
  const sidesBox = el<HTMLElement>('sides');
  const readout = el<HTMLElement>('readout');
  const editFleet = el<HTMLAnchorElement>('editFleet');

  let skirmish: Skirmish | null = null;
  let battle: CustomBattle | null = null;
  let activity = new Activity(2);
  let decision: Decision | null = null;

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
      if (decision !== null) decided(decision);
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
  const speed = el<HTMLSelectElement>('speed');
  speed.addEventListener('change', () => view.setSpeed(Number(speed.value)));
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
    nextPanel.hidden = true;
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
      outcome.textContent = `Victory ${at}.`;
      outcome.className = 'won';
      fillChoices(nextSelect, false);
      nextPanel.hidden = false;
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
  el<HTMLButtonElement>('nextRound').addEventListener('click', () => {
    const enemy = read(nextSelect.value);
    if (skirmish === null || enemy === null) return;
    skirmish = nextRound(skirmish, enemy);
    save();
    showRound();
  });
  el<HTMLButtonElement>('abandon').addEventListener('click', () => {
    if (!window.confirm('Give up this skirmish and start another?')) return;
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
  }
}

/** The enemy where it will stand, in its colour, with nobody yet on the other side. */
function enemyAlone(enemy: Fleet): CustomBattle {
  return customBattle({ ...DEFAULT_SETUP, fleets: [{ name: '', designs: {}, ships: [] }, enemy] });
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}
