import {
    overriddenMount,
    placementOf,
    slotKey,
    type DoctrineOverride,
    type DoctrinePart,
    type ModuleSpec,
    type ShipDesign,
    type ShipView,
} from "../sim/index.js";
import type { DoctrineEntry } from "./doctrine.js";

/**
 * What the picked ships of a battle go by, part by part, for a doctrine panel
 * to show and tell: each box's value across them, whether an order has told it,
 * and what their pads and slipways build and keep.
 */

/** One box's value across the picked ships, or undefined where they differ; null where none has it. */
export type Shared = number | undefined | null;

export function shared(values: readonly number[]): Shared {
    if (values.length === 0) return null;
    return values.every((v) => v === values[0]) ? values[0]! : undefined;
}

/** The mounts of `ship` that `part` covers, by turret index. */
export function mountsOf(design: ShipDesign, part: DoctrinePart): number[] {
    const out: number[] = [];
    design.turrets.forEach((mount, t) => {
        if (
            part === "main"
                ? mount.main
                : part === "secondary"
                  ? !mount.main
                  : `placement:${placementOf(keyOf(design, mount.module))}` === part
        ) {
            out.push(t);
        }
    });
    return out;
}

export function keyOf(design: ShipDesign, module: number): string | undefined {
    return design.keys?.[design.modules[module]?.index ?? -1];
}

/** What `ship` goes by for `field` of `part`: each covered mount's, or the ship's. */
export function valuesOf(ship: ShipView, part: DoctrinePart, row: DoctrineEntry): number[] {
    const design = ship.currentStructure;
    if (part === "ship") {
        const half = row.half === "approach" ? ship.doctrine?.approach : ship.doctrine?.targeting;
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
export function told(override: DoctrineOverride | undefined, part: DoctrinePart, row: DoctrineEntry): boolean {
    if (override === undefined) return false;
    const held =
        part === "ship"
            ? row.half === "approach"
                ? override.approach
                : override.targeting
            : part === "main" || part === "secondary"
              ? override[part]
              : override.placements?.[part.slice("placement:".length)];
    return (held as Record<string, number> | undefined)?.[row.field] !== undefined;
}

/** A pad or slipway of a picked ship, by its lasting key. */
export interface BuildSlot {
    readonly key: string;
    readonly label: string;
    readonly keep: number | undefined;
    readonly pad: boolean;
    readonly spec: ModuleSpec;
    /** The name of what it is told to build, or of what it builds by design; undefined where they differ. */
    readonly craft: string | undefined;
}

export function slotsOf(ships: readonly ShipView[]): BuildSlot[] {
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
            label: slot.pad ? "Pad" : "Slipway",
            keep: shared(slot.keeps) ?? undefined,
            pad: slot.pad,
            spec: slot.spec,
            craft,
        };
    });
}
