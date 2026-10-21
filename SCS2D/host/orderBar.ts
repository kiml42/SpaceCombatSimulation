import type { Snapshot } from '../sim/index.js';
import { OrderCancelCondition } from '../sim/ships.js';
import { teamName } from '../render/teams.js';
import { sideOf, viewOf } from '../render/picking.js';
import { choices, remodels, type Remodel } from './designChoices.js';
import { ANYWHERE, type BattleView, type Verb } from './battleView.js';
import { el } from './dom.js';

/**
 * The bar of orders under a battle, shown while ships are picked out: a
 * button a verb, each arming the next click on a ship, the conditions an
 * attack may finish on, Stop, and for one ship, what it has been told, each
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
  remodelTo.addEventListener('change', () => {
    remodel.disabled = remodelTo.value === '';
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
    const options = offered.map(({ choice, kept, of }, n) => {
      const option = document.createElement('option');
      option.value = String(n);
      option.textContent = `${choice.label} · keeps ${Math.round((100 * kept) / Math.max(1, of))}%`;
      return option;
    });
    remodelTo.replaceChildren(current, ...options);
    remodelTo.value = '';
    remodelTo.disabled = offered.length === 0;
    remodel.disabled = true;
    remodel.hidden = !crewed;
  };

  return {
    update(shown) {
      const side = sideOf(shown, view.picked);
      bar.hidden = side === null;
      if (side === null) {
        remodelKey = '';
        return;
      }
      showRemodel(shown);
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
        let named = order.kind === 'dock' || order.kind === 'scavenge' || order.kind === 'deliver' ? 'nearest' : 'gone';
        for (let i = 0; i < shown.shipCount; i++) {
          const target = shown.ships[i]!;
          if (target.body === order.target) named = `${teamName(target.team)} ${target.name ?? target.serial}`;
        }
        return `${order.kind} ${named}`;
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
