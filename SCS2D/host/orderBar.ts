import type { Snapshot } from '../sim/index.js';
import { OrderCancelCondition } from '../sim/ships.js';
import { teamName } from '../render/teams.js';
import { viewOf } from '../render/picking.js';
import { choices, remodels, type Remodel } from './designChoices.js';
import { ANYWHERE, type BattleView, type Verb } from './battleView.js';
import { el } from './dom.js';

/**
 * The bar of orders under a battle, shown while ships are picked out: a
 * button a verb, each arming the next click on a ship, the conditions an
 * attack may finish on, how far off and how fast to hold, Stop, and for one ship, what it has been told, each
 * order with a ✕ to take it back.
 */
export function orderBar(view: BattleView): { update(shown: Snapshot): void } {
  const bar = el<HTMLElement>('orderBar');
  const cancelOn = el<HTMLSelectElement>('cancelOn');
  const queue = el<HTMLOListElement>('queue');
  const hint = el<HTMLElement>('armedHint');
  const anywhere = el<HTMLButtonElement>('nearest');
  let listed = '';
  const remodelTo = el<HTMLSelectElement>('remodelTo');
  const remodel = el<HTMLButtonElement>('remodel');
  let offered: Remodel[] = [];
  let remodelKey = '';
  const remodelWarning = el<HTMLElement>('remodelWarning');
  const holdDistance = el<HTMLInputElement>('holdDistance');
  const holdSpeed = el<HTMLInputElement>('holdSpeed');
  /** What a box says, if it says something that may be told: empty or out of range is doctrine's. */
  const told = (input: HTMLInputElement, positive: boolean): number | undefined => {
    const value = input.value.trim() === '' ? NaN : Number(input.value);
    return Number.isFinite(value) && (positive ? value > 0 : value >= 0) ? value : undefined;
  };
  const hold = (): void => {
    const distance = told(holdDistance, false);
    const speed = told(holdSpeed, true);
    view.held = { ...(distance === undefined ? {} : { distance }), ...(speed === undefined ? {} : { speed }) };
  };
  holdDistance.addEventListener('input', hold);
  holdSpeed.addEventListener('input', hold);
  remodelTo.addEventListener('change', () => {
    remodel.disabled = remodelTo.value === '';
    const fit = offered[Number(remodelTo.value)];
    remodelWarning.hidden = remodelTo.value === '' || fit === undefined || fit.bay;
  });
  remodel.addEventListener('click', () => {
    const fit = offered[Number(remodelTo.value)];
    if (remodelTo.value === '' || fit === undefined) return;
    view.issue({ kind: 'remodel', ships: view.picked, blueprint: fit.choice.blueprint });
  });

  for (const button of bar.querySelectorAll<HTMLButtonElement>('button[data-verb]')) {
    button.addEventListener('click', () => {
      const verb = button.dataset['verb'] as Verb;
      view.arm(view.armed === verb ? null : verb, Number(cancelOn.value) as OrderCancelCondition);
    });
  }
  anywhere.addEventListener('click', (event) => view.nearest(event.ctrlKey || event.metaKey || event.shiftKey));
  el<HTMLButtonElement>('stop').addEventListener('click', () => {
    if (view.picked.length > 0) view.issue({ kind: 'stop', ships: view.picked });
  });

  /**
   * What the picked ships are built to, and what else they could be: a choice
   * shown, not given, until Remodel is pressed, and put back to what they are
   * whenever the picking changes. Only ships with robots can rebuild themselves.
   */
  const showRemodel = (shown: Snapshot): void => {
    const ships = view.picked.map((i) => viewOf(shown, i)).filter((s) => s !== null);
    const names = ships.map((s) => (s.blueprint ?? s.currentStructure).name);
    const crewed = ships.length > 0 && ships.every((s) => (s.crews ?? []).some((n) => n > 0));
    const key = JSON.stringify([view.picked, names, crewed]);
    if (key === remodelKey) return;
    remodelKey = key;
    offered = crewed ? remodels(ships, choices()) : [];
    const current = document.createElement('option');
    current.value = '';
    current.textContent = names.every((n) => n === names[0]) ? (names[0] ?? '') : 'mixed designs';
    const options = offered.map(({ choice, kept, of, bay }, n) => {
      const option = document.createElement('option');
      option.value = String(n);
      option.textContent = `${choice.label} · keeps ${Math.round((100 * kept) / Math.max(1, of))}%${bay ? '' : ' · ⚠ no robot bay'}`;
      return option;
    });
    remodelTo.replaceChildren(current, ...options);
    remodelTo.value = '';
    remodelTo.disabled = offered.length === 0;
    remodel.disabled = true;
    remodel.hidden = !crewed;
    remodelWarning.hidden = true;
  };

  const card = el<HTMLElement>('asteroidCard');
  let carded = '';
  /** What is left in an asteroid picked out alone. */
  const showAsteroid = (shown: Snapshot): void => {
    const rock = view.picked.length === 1 ? viewOf(shown, view.picked[0])?.rock : undefined;
    const text = rock === undefined ? '' : `rock ${tonnes(rock.rock)} · ore ${tonnes(rock.ore)} · ice ${tonnes(rock.ice)}`;
    card.hidden = rock === undefined;
    if (text === carded) return;
    carded = text;
    const title = document.createElement('b');
    title.textContent = 'Asteroid ';
    card.replaceChildren(title, text);
  };

  return {
    update(shown) {
      showAsteroid(shown);
      const side = view.orderSide(shown);
      bar.hidden = side === null;
      if (side === null) {
        remodelKey = '';
        return;
      }
      showRemodel(shown);
      // Only an attack or defence holds a distance, and a ram a speed too.
      const armed = view.armed;
      holdDistance.disabled = armed !== null && armed !== 'attack' && armed !== 'defend';
      holdSpeed.disabled = armed !== null && armed !== 'attack' && armed !== 'defend' && armed !== 'ram';
      const speeds = view.picked.map((i) => viewOf(shown, i)?.doctrine?.approach.approachSpeed);
      holdSpeed.placeholder = speeds.length > 0 && speeds.every((v) => v !== undefined && v === speeds[0]) ? `${speeds[0]}` : 'doctrine';
      const optional = view.armed !== null && ANYWHERE.has(view.armed);
      hint.textContent = view.armed === null ? '' : `click a ship to ${view.armed} · Ctrl to queue · Esc${optional ? ' · or' : ''}`;
      anywhere.hidden = !optional;
      for (const button of bar.querySelectorAll<HTMLButtonElement>('button[data-verb]')) {
        button.classList.toggle('armed', button.dataset['verb'] === view.armed);
      }
      // What one ship has been told; rebuilt only when it changes, so a ✕ stays under the pointer.
      const ship = view.picked.length === 1 ? viewOf(shown, view.picked[0]) : null;
      const orders = (ship?.orders ?? []).map((order) => {
        // Docking anywhere, before doctrine has chosen where.
        let named =
          order.kind === 'flee'
            ? 'every enemy'
            : order.kind === 'dock' || order.kind === 'scavenge' || order.kind === 'deliver'
              ? 'nearest'
              : 'gone';
        for (let i = 0; i < shown.shipCount; i++) {
          const target = shown.ships[i]!;
          if (target.body === order.target)
            named = target.rock === undefined ? `${teamName(target.team)} ${target.name ?? target.serial}` : 'asteroid';
        }
        const distance = order.distance === undefined ? '' : ` · ${order.distance} m`;
        const speed = order.speed === undefined ? '' : ` · ${order.speed} m/s`;
        return `${order.kind} ${named}${distance}${speed}`;
      });
      const key = `${ship?.ship ?? -1}|${orders.join('|')}`;
      if (key === listed) return;
      listed = key;
      queue.replaceChildren(
        ...orders.map((text, index) => {
          const item = document.createElement('li');
          item.textContent = `${text} `;
          const drop = document.createElement('button');
          drop.textContent = '✕';
          drop.title = 'Take this order back';
          drop.addEventListener('click', () => view.issue({ kind: 'drop', ship: ship!.ship!, index }));
          item.append(drop);
          return item;
        }),
      );
    },
  };
}

/** A mass in tonnes, to three figures or so. */
function tonnes(kg: number): string {
  const t = kg / 1000;
  return `${t >= 100 ? Math.round(t).toLocaleString('en-GB') : t.toPrecision(3)} t`;
}
