import {
  overriddenMount,
  placementOf,
  slotKey,
  type DoctrineOverride,
  type DoctrinePart,
  type ShipDesign,
  type ShipView,
  type Snapshot,
} from '../sim/index.js';
import { MOUNT_SECTIONS, SHIP_SECTIONS, sectionEntries, type DoctrineEntry } from '../editor/doctrine.js';
import { mountAt, sideOf, viewOf } from '../render/picking.js';
import type { BattleView } from './battleView.js';
import { el } from './dom.js';

/**
 * The doctrine of the picked ships, beside the order bar: the ship's, its
 * main and its secondary weapons', one placement's mounts, picked by clicking
 * one, and what its pads and slipways keep. Each box shows what the ships go
 * by, blank where they differ; an edit is a logged command for all of them,
 * over their blueprints, and clearing a box takes it back to theirs.
 */

const SHIP_ROWS = sectionEntries(SHIP_SECTIONS);
const MOUNT_ROWS = sectionEntries(MOUNT_SECTIONS);
const PART_KEY = 'p';

/** One box's value across the picked ships, or undefined where they differ; null where none has it. */
type Shared = number | undefined | null;

function shared(values: readonly number[]): Shared {
  if (values.length === 0) return null;
  return values.every((v) => v === values[0]) ? values[0]! : undefined;
}

/** The mounts of `ship` that `part` covers, by turret index. */
function mountsOf(design: ShipDesign, part: DoctrinePart): number[] {
  const out: number[] = [];
  design.turrets.forEach((mount, t) => {
    if (
      part === 'main' ? mount.main : part === 'secondary' ? !mount.main : `placement:${placementOf(keyOf(design, mount.module))}` === part
    ) {
      out.push(t);
    }
  });
  return out;
}

function keyOf(design: ShipDesign, module: number): string | undefined {
  return design.keys?.[design.modules[module]?.index ?? -1];
}

/** What `ship` goes by for `field` of `part`: each covered mount's, or the ship's. */
function valuesOf(ship: ShipView, part: DoctrinePart, row: DoctrineEntry): number[] {
  const design = ship.currentStructure;
  if (part === 'ship') {
    const half = row.half === 'approach' ? ship.doctrine?.approach : ship.doctrine?.targeting;
    const value = (half as unknown as Record<string, number> | undefined)?.[row.field];
    return value === undefined ? [] : [value];
  }
  return mountsOf(design, part).map((t) => {
    const mount = design.turrets[t]!;
    const resolved = overriddenMount(mount.targeting, mount.main, placementOf(keyOf(design, mount.module)), ship.override);
    return (resolved as unknown as Record<string, number>)[row.field]!;
  });
}

/** Whether `override` tells `field` of `part`. */
function told(override: DoctrineOverride | undefined, part: DoctrinePart, row: DoctrineEntry): boolean {
  if (override === undefined) return false;
  const held =
    part === 'ship'
      ? row.half === 'approach'
        ? override.approach
        : override.targeting
      : part === 'main' || part === 'secondary'
        ? override[part]
        : override.placements?.[part.slice('placement:'.length)];
  return (held as Record<string, number> | undefined)?.[row.field] !== undefined;
}

/** A pad or slipway of a picked ship, by its lasting key. */
interface Slot {
  readonly key: string;
  readonly label: string;
  readonly keep: number | undefined;
}

function slotsOf(ships: readonly ShipView[]): Slot[] {
  const found = new Map<string, { label: string; keeps: number[] }>();
  for (const ship of ships) {
    const design = ship.blueprint ?? ship.currentStructure;
    const add = (module: number, kind: string, craft: ShipDesign, keep: number): void => {
      const key = slotKey(design, module);
      const keeps = found.get(key)?.keeps ?? [];
      keeps.push(ship.keeps?.[key] ?? keep);
      found.set(key, { label: `${kind} · ${craft.name}`, keeps });
    };
    for (const order of design.builds ?? []) add(order.pad, 'Pad', order.design, order.keep);
    for (const order of design.yards ?? []) add(order.slipway, 'Slipway', order.design, order.keep);
  }
  return [...found].map(([key, { label, keeps }]) => ({ key, label, keep: shared(keeps) ?? undefined }));
}

export function doctrinePanel(view: BattleView): { update(shown: Snapshot): void } {
  const panel = el<HTMLElement>('doctrinePanel');
  const toggle = el<HTMLButtonElement>('doctrine');
  let open = false;
  let part: DoctrinePart = 'ship';
  let shownKey = '';
  /** Rebuild at the next frame whatever has focus: after an edit, so it shows what it now holds. */
  let force = false;
  let last: Snapshot | null = null;

  const setOpen = (next: boolean): void => {
    open = next;
    toggle.classList.toggle('armed', open);
    if (!open) {
      part = 'ship';
      view.mark(null);
    }
    shownKey = '';
    force = true;
  };
  toggle.addEventListener('click', () => setOpen(!open));
  window.addEventListener('keydown', (event) => {
    const focus = document.activeElement;
    if (focus instanceof HTMLInputElement || focus instanceof HTMLTextAreaElement || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.toLowerCase() === PART_KEY && view.picked.length > 0) setOpen(!open);
  });

  // With the panel open on one ship, a click on one of its mounts tells that placement.
  view.pickPart((ship, x, y) => {
    if (!open || view.picked.length !== 1 || ship.ship !== view.picked[0]) return false;
    const module = mountAt(ship, x, y);
    if (module < 0) return false;
    const placement = placementOf(keyOf(ship.currentStructure, module));
    if (placement === undefined) return false;
    part = `placement:${placement}`;
    shownKey = '';
    force = true;
    return true;
  });

  const issue = (field: string, value: number | null): void => {
    view.issue({ kind: 'doctrine', ships: view.picked, part, field, value });
    shownKey = '';
    force = true;
  };

  const rows = (ships: readonly ShipView[]): HTMLElement[] => {
    const out: HTMLElement[] = [];
    for (const row of part === 'ship' ? SHIP_ROWS : MOUNT_ROWS) {
      const values = ships.flatMap((ship) => valuesOf(ship, part, row));
      const value = shared(values);
      if (value === null) continue;
      const label = document.createElement('label');
      label.title = row.hint;
      const name = document.createElement('span');
      name.textContent = row.label;
      const input = document.createElement('input');
      input.type = 'number';
      input.step = String(row.step);
      input.dataset['field'] = row.field;
      input.value = value === undefined ? '' : String(value);
      input.placeholder = value === undefined ? 'mixed' : '';
      const says = ships.some((ship) => told(ship.override, part, row));
      label.classList.toggle('told', says);
      input.addEventListener('change', () => {
        const typed = input.value.trim();
        issue(row.field, typed === '' ? null : Number(typed));
      });
      label.append(name);
      // Left of the box, so the box and its arrows stay put as it comes and goes.
      if (says) {
        const back = document.createElement('button');
        back.textContent = '↺';
        back.title = 'Back to its design';
        back.addEventListener('click', () => issue(row.field, null));
        label.append(back);
      }
      label.append(input);
      out.push(label);
    }
    return out;
  };

  const slots = (ships: readonly ShipView[]): HTMLElement[] =>
    slotsOf(ships).map((slot) => {
      const label = document.createElement('label');
      label.title = 'How many of these it keeps in the fight';
      const name = document.createElement('span');
      name.textContent = slot.label;
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.step = '1';
      input.value = slot.keep === undefined ? '' : String(slot.keep);
      input.placeholder = slot.keep === undefined ? 'mixed' : '';
      input.addEventListener('change', () => {
        const typed = input.value.trim();
        view.issue({
          kind: 'keep',
          ships: view.picked,
          slot: slot.key,
          keep: typed === '' ? null : Math.max(0, Math.floor(Number(typed))),
        });
        shownKey = '';
        force = true;
      });
      label.append(name, input);
      return label;
    });

  const render = (ships: readonly ShipView[]): void => {
    const tabs = document.createElement('div');
    tabs.className = 'tabs';
    const parts: [DoctrinePart, string][] = [
      ['ship', 'Ship'],
      ['main', 'Main weapons'],
      ['secondary', 'Secondary weapons'],
    ];
    if (part.startsWith('placement:')) parts.push([part, 'This mount']);
    for (const [p, name] of parts) {
      const tab = document.createElement('button');
      tab.textContent = name;
      tab.classList.toggle('armed', p === part);
      tab.addEventListener('click', () => {
        part = p;
        shownKey = '';
        force = true;
        if (last !== null) update(last);
      });
      tabs.append(tab);
    }
    const body = document.createElement('div');
    body.className = 'rows';
    body.append(...rows(ships));
    if (part === 'ship') body.append(...slots(ships));
    if (body.childElementCount === 0) body.textContent = part === 'ship' ? '' : 'No such weapons';
    const reset = document.createElement('button');
    reset.textContent = 'Revert all';
    reset.title = 'Take all of this back to what the blueprint says';
    reset.addEventListener('click', () => {
      view.issue({ kind: 'resetDoctrine', ships: view.picked, part });
      shownKey = '';
      force = true;
    });
    const hint = document.createElement('p');
    hint.textContent = view.picked.length === 1 ? 'Click a mount to tell it, and every copy of it, alone.' : '';
    panel.replaceChildren(tabs, body, reset, hint);
  };

  const update = (shown: Snapshot): void => {
    last = shown;
    const side = sideOf(shown, view.picked);
    toggle.hidden = side === null;
    panel.hidden = !open || side === null;
    if (panel.hidden) {
      view.mark(null);
      return;
    }
    const ships = view.picked.map((i) => viewOf(shown, i)).filter((s): s is ShipView => s !== null);
    // The mounts it is telling, on the one ship they were picked on.
    const one = ships.length === 1 ? ships[0]! : null;
    if (part.startsWith('placement:') && one !== null) {
      const modules = mountsOf(one.currentStructure, part).map((t) => one.currentStructure.turrets[t]!.module);
      view.mark({ ship: one.ship!, modules });
    } else {
      if (part.startsWith('placement:')) part = 'ship';
      view.mark(null);
    }
    // Rebuilt only when what it shows changes, and never under a box being typed in.
    const key = JSON.stringify([
      view.picked,
      part,
      ships.map((s) => [s.override ?? null, s.keeps ?? null, s.currentStructure.turrets.length, s.blueprint?.name ?? '']),
    ]);
    // Never rebuilt under a box being typed in, unless that box has just been told.
    const focus = document.activeElement;
    const typing = panel.contains(focus) && (focus instanceof HTMLInputElement || focus instanceof HTMLSelectElement);
    if (key === shownKey || (typing && !force)) return;
    const fields = [...panel.querySelectorAll('input, select')];
    const at = typing ? fields.indexOf(focus) : -1;
    shownKey = key;
    force = false;
    render(ships);
    // Back where it was, so a Tab after an edit goes on to the next box.
    if (at >= 0) (panel.querySelectorAll('input, select')[at] as HTMLElement | undefined)?.focus();
  };
  return { update };
}
