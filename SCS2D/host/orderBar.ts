import type { Snapshot } from '../sim/index.js';
import { OrderCancelCondition } from '../sim/ships.js';
import { teamName } from '../render/teams.js';
import { sideOf, viewOf } from '../render/picking.js';
import type { BattleView, Verb } from './battleView.js';
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
  let listed = '';

  for (const button of bar.querySelectorAll<HTMLButtonElement>('button[data-verb]')) {
    button.addEventListener('click', () => {
      const verb = button.dataset['verb'] as Verb;
      view.arm(view.armed === verb ? null : verb, Number(cancelOn.value) as OrderCancelCondition);
    });
  }
  el<HTMLButtonElement>('stop').addEventListener('click', () => {
    if (view.picked.length > 0) view.issue({ kind: 'stop', ships: view.picked });
  });

  return {
    update(shown) {
      const side = sideOf(shown, view.picked);
      bar.hidden = side === null;
      if (side === null) return;
      hint.textContent = view.armed === null ? '' : `click a ship to ${view.armed} · Ctrl to queue · Esc`;
      for (const button of bar.querySelectorAll<HTMLButtonElement>('button[data-verb]')) {
        button.classList.toggle('armed', button.dataset['verb'] === view.armed);
      }
      // What one ship has been told; rebuilt only when it changes, so a ✕ stays under the pointer.
      const ship = view.picked.length === 1 ? viewOf(shown, view.picked[0]) : null;
      const orders = (ship?.orders ?? []).map((order) => {
        let named = 'gone';
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
