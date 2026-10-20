import {
  compileBlueprint,
  overriddenMount,
  padHolds,
  placementOf,
  refitShare,
  slipwayHolds,
  slotKey,
  type Blueprint,
  type ModuleSpec,
  type DoctrineOverride,
  type DoctrinePart,
  type ShipDesign,
  type ShipView,
  type Snapshot,
} from '../sim/index.js';
import { MOUNT_SECTIONS, SHIP_SECTIONS, sectionEntries, type DoctrineEntry } from '../editor/doctrine.js';
import { Library } from '../editor/library.js';
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
  readonly pad: boolean;
  readonly spec: ModuleSpec;
  /** The name of what it is told to build, or of what it builds by design; undefined where they differ. */
  readonly craft: string | undefined;
}

/** A design that can be chosen to remodel to or to build: the blueprint, compiled, and where it is from. */
interface Choice {
  readonly blueprint: Blueprint;
  readonly design: ShipDesign;
  readonly label: string;
}

/** The blueprint library, stock and saved, each compiled once; one that does not compile is left out. */
function choices(): Choice[] {
  const library = new Library(window.localStorage);
  const out: Choice[] = [];
  for (const entry of library.list()) {
    try {
      const blueprint = entry.stock ? library.loadStock(entry.name) : library.load(entry.name);
      if (blueprint === null) continue;
      const cacheKey = `${entry.stock ? 'stock' : 'saved'}:${entry.name}`;
      let design = compiledChoices.get(cacheKey);
      if (design === undefined || design.blueprint !== blueprint) {
        design = { blueprint, design: compileBlueprint(blueprint) };
        compiledChoices.set(cacheKey, design);
      }
      out.push({ ...design, label: entry.stock && entry.saved ? `${entry.name} (stock)` : entry.name });
    } catch {
      // A saved ship that no longer reads or flies is for the editor to put right.
    }
  }
  return out;
}
const compiledChoices = new Map<string, { blueprint: Blueprint; design: ShipDesign }>();

function slotsOf(ships: readonly ShipView[]): Slot[] {
  const found = new Map<string, { pad: boolean; spec: ModuleSpec; keeps: number[]; crafts: string[] }>();
  for (const ship of ships) {
    const design = ship.blueprint ?? ship.currentStructure;
    const add = (module: number, pad: boolean, craft: ShipDesign, keep: number): void => {
      const key = slotKey(design, module);
      const slot = found.get(key) ?? { pad, spec: design.modules[module]!.spec, keeps: [], crafts: [] };
      slot.keeps.push(ship.keeps?.[key] ?? keep);
      slot.crafts.push((ship.crafts?.[key] ?? craft).name);
      found.set(key, slot);
    };
    for (const order of design.builds ?? []) add(order.pad, true, order.design, order.keep);
    for (const order of design.yards ?? []) add(order.slipway, false, order.design, order.keep);
  }
  return [...found].map(([key, slot]) => {
    const craft = slot.crafts.every((c) => c === slot.crafts[0]) ? slot.crafts[0] : undefined;
    return {
      key,
      label: slot.pad ? 'Pad' : 'Slipway',
      keep: shared(slot.keeps) ?? undefined,
      pad: slot.pad,
      spec: slot.spec,
      craft,
    };
  });
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

  const slots = (ships: readonly ShipView[], library: readonly Choice[]): HTMLElement[] =>
    slotsOf(ships).map((slot) => {
      const label = document.createElement('label');
      label.title = 'What it builds, and how many of them it keeps in the fight';
      const name = document.createElement('span');
      name.textContent = slot.label;
      // What it builds: as designed, or anything in the library it could build.
      const craft = document.createElement('select');
      const designed = document.createElement('option');
      designed.value = '';
      designed.textContent = slot.craft ?? 'mixed';
      craft.append(designed);
      const buildable = library.filter((choice) =>
        slot.pad
          ? choice.design.fighter && padHolds(choice.design, slot.spec)
          : !choice.design.fighter && slipwayHolds(choice.design, slot.spec),
      );
      buildable.forEach((choice, n) => {
        const option = document.createElement('option');
        option.value = String(n);
        option.textContent = choice.label;
        craft.append(option);
      });
      craft.addEventListener('change', () => {
        const choice = buildable[Number(craft.value)];
        if (craft.value === '' || choice === undefined) return;
        view.issue({ kind: 'craft', ships: view.picked, slot: slot.key, blueprint: choice.blueprint });
        shownKey = '';
        force = true;
      });
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
      label.append(name);
      // Left of the boxes, so they stay put as it comes and goes.
      if (ships.some((ship) => ship.crafts?.[slot.key] !== undefined)) {
        const back = document.createElement('button');
        back.textContent = '↺';
        back.title = 'Back to what its design builds';
        back.addEventListener('click', () => {
          view.issue({ kind: 'craft', ships: view.picked, slot: slot.key, blueprint: null });
          shownKey = '';
          force = true;
        });
        label.append(back);
      }
      label.append(craft, input);
      return label;
    });

  /** A remodel: to any design in the library that a refit of every picked ship would take, and how much it keeps. */
  const remodel = (ships: readonly ShipView[], library: readonly Choice[]): HTMLElement => {
    const row = document.createElement('label');
    row.title = 'Refit them to another design, which their robots build as they fight on';
    const name = document.createElement('span');
    name.textContent = 'Remodel to';
    const pick = document.createElement('select');
    const none = document.createElement('option');
    none.value = '';
    none.textContent = '—';
    pick.append(none);
    const fits = library.flatMap((choice) => {
      let kept = 0;
      let of = 0;
      for (const ship of ships) {
        const share = refitShare(ship.blueprint ?? ship.currentStructure, choice.design);
        if (share === null) return [];
        kept += share.kept;
        of += share.of;
      }
      // Not a remodel at all.
      if (kept === of && ships.every((ship) => (ship.blueprint ?? ship.currentStructure).modules.length === choice.design.modules.length)) {
        return [];
      }
      return [{ choice, kept, of }];
    });
    fits.forEach(({ choice, kept, of }, n) => {
      const option = document.createElement('option');
      option.value = String(n);
      option.textContent = `${choice.label} · keeps ${Math.round((100 * kept) / Math.max(1, of))}%`;
      pick.append(option);
    });
    pick.disabled = fits.length === 0;
    if (fits.length === 0) none.textContent = 'nothing it could refit to';
    const go = document.createElement('button');
    go.textContent = 'Remodel';
    go.addEventListener('click', () => {
      const fit = fits[Number(pick.value)];
      if (pick.value === '' || fit === undefined) return;
      view.issue({ kind: 'remodel', ships: view.picked, blueprint: fit.choice.blueprint });
      shownKey = '';
      force = true;
    });
    row.append(name, pick, go);
    return row;
  };

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
    if (part === 'ship') {
      const library = choices();
      body.append(remodel(ships, library), ...slots(ships, library));
    }
    if (body.childElementCount === 0) body.textContent = part === 'ship' ? '' : 'No such weapons';
    const reset = document.createElement('button');
    reset.textContent = '↺ Revert all';
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
      ships.map((s) => [
        s.override ?? null,
        s.keeps ?? null,
        Object.entries(s.crafts ?? {}).map(([slot, craft]) => [slot, craft.name]),
        s.currentStructure.turrets.length,
        s.blueprint?.name ?? '',
      ]),
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
