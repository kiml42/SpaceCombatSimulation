import { parseFleet, type Fleet } from '../sim/index.js';
import { teamColour } from '../render/canvas2d.js';
import { FLEET_FILES, Library } from '../editor/library.js';
import {
  DEFAULT_SETUP,
  parseBattleSetup,
  serialiseBattleSetup,
  tally,
  winner,
  type BattleSetup,
  type CustomBattle,
} from '../scenarios/customBattle.js';
import { el } from './dom.js';

/**
 * The viewer's custom battle panel: which fleets, how far apart, how fast, and
 * how each side is doing. Owns the setup; the viewer asks it for one to fight.
 */

/** The sides' colours by name, as the footer calls them. */
const SIDE_NAMES = ['blue', 'red', 'green', 'magenta'];

/** Where a fleet in a slot came from: the library by name, or a file. */
interface Slot {
  fleet: Fleet;
  /** Null for a fleet read from a file, which the library cannot give back. */
  library: string | null;
}

export interface CustomPanel {
  show(visible: boolean): void;
  setup(): BattleSetup;
  /** Refresh the sides table; returns true the first time the battle is decided. */
  update(battle: CustomBattle, time: number): boolean;
  /** Forget any result, for a battle starting again. */
  reset(): void;
}

export function customPanel(fight: () => void): CustomPanel {
  const panel = el<HTMLElement>('custom');
  const slotsBox = el<HTMLElement>('fleetSlots');
  const sidesBox = el<HTMLElement>('sides');
  const outcome = el<HTMLElement>('outcome');
  const range = el<HTMLInputElement>('battleRange');
  const closing = el<HTMLInputElement>('battleClosing');
  const crossing = el<HTMLInputElement>('battleCrossing');
  const seed = el<HTMLInputElement>('battleSeed');

  const fleets = new Library(window.localStorage, FLEET_FILES);
  const read = (name: string): Fleet | null => {
    try {
      return fleets.load(name);
    } catch (error) {
      window.alert(`Could not read the saved ${name}.\n\n${error instanceof Error ? error.message : error}`);
      return null;
    }
  };
  const firstName = fleets.list()[0]?.name ?? '';
  const first = read(firstName);
  const slots: Slot[] =
    first === null ? [] : [{ fleet: first, library: firstName }, { fleet: first, library: firstName }];
  let decided = false;

  const fill = (setup: Omit<BattleSetup, 'fleets'>): void => {
    range.value = String(setup.range);
    closing.value = String(setup.closingSpeed);
    crossing.value = String(setup.crossingSpeed);
    seed.value = String(setup.seed);
  };
  fill(DEFAULT_SETUP);

  const renderSlots = (): void => {
    const names = fleets.list().map((entry) => entry.name);
    const unique = [...new Set(names)];
    slotsBox.innerHTML = '';
    slots.forEach((slot, i) => {
      const row = document.createElement('div');
      row.className = 'slot';
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = teamColour(i);
      const select = document.createElement('select');
      const options = slot.library === null ? [`${slot.fleet.name} (file)`, ...unique] : unique;
      for (const name of options) {
        const option = document.createElement('option');
        option.textContent = name;
        option.value = name;
        select.append(option);
      }
      select.value = slot.library ?? `${slot.fleet.name} (file)`;
      select.addEventListener('change', () => {
        const fleet = read(select.value);
        if (fleet !== null) slots[i] = { fleet, library: select.value };
        renderSlots();
      });
      const remove = document.createElement('button');
      remove.textContent = '×';
      remove.title = 'Take this side out';
      remove.disabled = slots.length <= 2;
      remove.addEventListener('click', () => {
        slots.splice(i, 1);
        renderSlots();
      });
      row.append(swatch, select, remove);
      slotsBox.append(row);
    });
  };

  el<HTMLButtonElement>('addFleet').addEventListener('click', () => {
    const last = slots[slots.length - 1];
    const name = last?.library ?? firstName;
    const fleet = read(name);
    if (fleet !== null) slots.push({ fleet, library: name });
    renderSlots();
  });

  const pick = (input: HTMLInputElement, use: (text: string) => void): void => {
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file === undefined) return;
      void file.text().then((text) => {
        try {
          use(text);
        } catch (error) {
          window.alert(`Could not read that file.\n\n${error instanceof Error ? error.message : error}`);
        }
        renderSlots();
      });
      input.value = '';
    });
  };

  const fleetFile = el<HTMLInputElement>('fleetFile');
  el<HTMLButtonElement>('fleetFromFile').addEventListener('click', () => fleetFile.click());
  pick(fleetFile, (text) => slots.push({ fleet: parseFleet(JSON.parse(text)), library: null }));

  const number = (input: HTMLInputElement, fallback: number): number => {
    const value = Number(input.value);
    return input.value.trim() === '' || !Number.isFinite(value) ? fallback : value;
  };
  const setup = (): BattleSetup => ({
    fleets: slots.map((slot) => slot.fleet),
    range: Math.max(1, number(range, DEFAULT_SETUP.range)),
    closingSpeed: number(closing, DEFAULT_SETUP.closingSpeed),
    crossingSpeed: number(crossing, DEFAULT_SETUP.crossingSpeed),
    seed: Math.round(number(seed, DEFAULT_SETUP.seed)),
  });

  el<HTMLButtonElement>('fight').addEventListener('click', fight);

  el<HTMLButtonElement>('exportBattle').addEventListener('click', () => {
    const text = `${JSON.stringify(serialiseBattleSetup(setup()), null, 2)}\n`;
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'battle.json';
    link.click();
    URL.revokeObjectURL(url);
  });
  const battleFile = el<HTMLInputElement>('battleFile');
  el<HTMLButtonElement>('importBattle').addEventListener('click', () => battleFile.click());
  pick(battleFile, (text) => {
    const loaded = parseBattleSetup(JSON.parse(text));
    slots.length = 0;
    for (const fleet of loaded.fleets) slots.push({ fleet, library: null });
    fill(loaded);
    fight();
  });

  renderSlots();

  let lastDrawn = -Infinity;
  return {
    show(visible) {
      panel.hidden = !visible;
    },
    setup,
    update(battle, time) {
      const now = tally(battle, battle.start.length);
      const result = winner(now);
      // Sampled a few times a simulated second rather than every frame: it is a
      // table to read, not an animation.
      if (result === null || decided) {
        if (time - lastDrawn < 0.2 && time >= lastDrawn) return false;
      }
      lastDrawn = time;
      const rows = battle.start.map((start, i) => {
        const side = now[i]!;
        const lost = start.mass > 0 ? (1 - side.mass / start.mass) * 100 : 0;
        const name = battle.setup.fleets[i]?.name ?? `Side ${i + 1}`;
        return (
          `<div class="side"><span class="swatch" style="background:${teamColour(i)}"></span>` +
          `<span class="sideName">${escapeHtml(name)}</span></div>` +
          `<div class="sideStats">${side.ships}/${start.ships} ships · ${side.armed} armed · ${Math.round(lost)}% of mass lost</div>`
        );
      });
      sidesBox.innerHTML = rows.join('');
      if (result === null || decided) return false;
      decided = true;
      const who =
        result < 0
          ? 'No side can fight on'
          : `${escapeHtml(battle.setup.fleets[result]?.name ?? '')} (${SIDE_NAMES[result] ?? 'grey'}) wins`;
      outcome.innerHTML = `${who} at ${time.toFixed(1)} s.`;
      return true;
    },
    reset() {
      decided = false;
      lastDrawn = -Infinity;
      outcome.textContent = '';
    },
  };
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}
