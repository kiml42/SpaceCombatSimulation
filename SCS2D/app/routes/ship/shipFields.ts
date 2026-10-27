import type { DesignInFleet } from "~/editor/handoff";
import type { Library } from "~/editor/library";
import {
    barrelCalibres,
    blueprintProblem,
    compileDraft,
    CORE_COMPUTING_SHARE,
    DEFAULT_BURST_SPEED,
    DEFAULT_FRAGMENTS,
    DEFAULT_FUSE,
    DEFAULT_NOZZLE_WIDTHS,
    math,
    moduleProblem,
    moduleStats,
    mountTraverse,
    radiansToDegrees,
    readsBarrelCalibres,
    type Blueprint,
    type ModuleKind,
    type ModuleSpec,
    type Placement,
    type ShipDesign,
    type ShipModuleKind,
} from "~/sim/index";

/**
 * What the ship editor's panels show, worked out from the blueprint: free of
 * React and the page, so each panel reads the same figures the same way.
 */

/** The ways a slipway can lay out what it builds (`ModuleSpec.craftAngle`), offered by name. */
export const CRAFT_ANGLES: readonly { degrees: number; label: string }[] = [
    { degrees: 0, label: "bow first" },
    { degrees: 90, label: "side first, bow turned +90°" },
    { degrees: -90, label: "side first, bow turned −90°" },
    { degrees: 180, label: "stern first" },
];

/** What a freshly added module of each kind starts as, metres. */
export const DEFAULTS: Record<ShipModuleKind, Omit<ModuleSpec, "x" | "y">> = {
    structure: { kind: "structure", length: 8, width: 5 },
    tank: { kind: "tank", length: 6, width: 4 },
    hold: { kind: "hold", length: 4, width: 3 },
    battery: { kind: "battery", length: 4, width: 3 },
    generator: { kind: "generator", length: 4, width: 4 },
    // Berths for four robots.
    robotBay: { kind: "robotBay", length: 4, width: 4 },
    core: { kind: "core", length: 3, width: 3 },
    // Facing aft along its bell, so it pushes the ship forward.
    engine: { kind: "engine", angle: math.PI, length: 1.5, width: 3 },
    turret: { kind: "turret", angle: 0, length: 4, width: 3, barrels: 1 },
    beamTurret: { kind: "beamTurret", angle: 0, length: 4, width: 3, barrels: 1 },
    hullGun: { kind: "hullGun", angle: 0, length: 4, width: 4, barrels: 1 },
    hullBeam: { kind: "hullBeam", angle: 0, length: 4, width: 4, barrels: 1 },
    claw: { kind: "claw", angle: 0, length: 2, width: 2 },
    // Room for a fighter to sit on, wholly inside it.
    pad: { kind: "pad", length: 12, width: 10 },
    // Facing out of the hull it is bolted to, its face the side that mates.
    port: { kind: "port", angle: 0, length: 1, width: 2 },
    // Facing out of the hull, the ship it builds coming out of its face.
    slipway: { kind: "slipway", angle: 0, length: 4, width: 12 },
};

export type ModuleNumberField =
    | "angle"
    | "reinforcement"
    | "barrels"
    | "nozzle"
    | "barrelCalibres"
    | "traverse"
    | "fuse"
    | "fragments"
    | "burstSpeed"
    | "sealing"
    | "drainPriority"
    | "fill"
    | "computing"
    | "robotsPerBerth"
    | "keep";

/** A module's own value for a field, with the default the parser would have applied. */
export function moduleField(spec: ModuleSpec, key: ModuleNumberField): number {
    if (key === "angle") return radiansToDegrees(spec.angle ?? 0);
    if (key === "reinforcement") return spec.reinforcement ?? 1;
    if (key === "nozzle") return spec.nozzle ?? DEFAULT_NOZZLE_WIDTHS;
    if (key === "barrelCalibres") return barrelCalibres(spec);
    // What the mount would do if the layout said nothing, so the box shows the
    // arc it actually has rather than a blank.
    if (key === "traverse") return radiansToDegrees(mountTraverse(spec));
    if (key === "fuse") return spec.fuse ?? DEFAULT_FUSE;
    if (key === "fragments") return spec.fragments ?? DEFAULT_FRAGMENTS;
    if (key === "burstSpeed") return spec.burstSpeed ?? DEFAULT_BURST_SPEED;
    // Millimetres on the panel, metres in the layout.
    if (key === "sealing") return (spec.sealing ?? 0) * 1000;
    if (key === "drainPriority") return spec.drainPriority ?? 0;
    // Per cent on the panel, a share in the layout.
    if (key === "fill") return (spec.fill ?? 1) * 100;
    if (key === "computing") return (spec.computing ?? CORE_COMPUTING_SHARE) * 100;
    if (key === "robotsPerBerth") return spec.robotsPerBerth ?? 1;
    if (key === "keep") return spec.keep ?? 0;
    return spec.barrels ?? 1;
}

/** How far each core reaches, and how many modules none of them does. */
export function controlReadout(design: ShipDesign): string {
    const reaches = design.cores.map((core) => `${design.modules[core]!.stats.controlRadius.toFixed(1)} m`);
    const out = design.coveredBy?.filter((cores) => cores !== null && cores.length === 0).length ?? 0;
    const cores = reaches.length === 1 ? `its core reaches ${reaches[0]}` : `its cores reach ${reaches.join(", ")}`;
    return out === 0 ? cores : `${cores}; ${out} module${out === 1 ? "" : "s"} out of reach will not work`;
}

/** A gun's barrel in metres, and how much of it is braced. */
export function barrelReadout(spec: ModuleSpec): string {
    if (!readsBarrelCalibres(spec.kind) || moduleProblem(spec) !== null) return "";
    const gun = moduleStats(spec).gun;
    if (gun === null) return "";
    const metres = `= ${gun.barrelLength.toFixed(2)} m`;
    return gun.braceLength > 0 ? `${metres}, ${gun.braceLength.toFixed(2)} m braced` : metres;
}

/** Each module out of every core's reach: it flies, but that module does nothing. */
export function reachWarnings(design: ShipDesign | null): string[] {
    const out: string[] = [];
    design?.coveredBy?.forEach((cores, m) => {
        if (cores === null || cores.length > 0) return;
        const module = design.modules[m]!;
        out.push(`module ${module.index} (${module.spec.kind}) is out of every core's reach, so it will not work`);
    });
    return out;
}

/**
 * A number at `places` decimals, widened until it shows at least two
 * significant figures.
 *
 * Without the floor, a small gun's shell reads as "0 kg" — a figure that is
 * not merely imprecise but wrong, since it says the round has no mass. The
 * decimals are a floor rather than a fixed count so a heavy shell still
 * reads 89.8 rather than being rounded to 90.
 */
export function numbers(value: number, places = 1, significant = 2): string {
    let decimals = places;
    if (value !== 0 && Number.isFinite(value)) {
        const magnitude = Math.floor(Math.log10(Math.abs(value)));
        decimals = Math.max(places, Math.min(20, significant - 1 - magnitude));
    }
    return value.toLocaleString("en-GB", { maximumFractionDigits: decimals });
}

export function isModuleSpec(placement: Placement): placement is ModuleSpec {
    return !("use" in placement);
}

/** Compiled designs by their layout, so a pad's or slipway's list does not recompile the library on every render. */
const craftCache = new Map<string, ShipDesign | null>();
function compiledCraft(blueprint: Blueprint): ShipDesign | null {
    const key = JSON.stringify(blueprint);
    const known = craftCache.get(key);
    if (known !== undefined) return known;
    const design = blueprintProblem(blueprint) === null ? compileDraft(blueprint) : null;
    craftCache.set(key, design);
    return design;
}

/** What a module of `kind` could build of `blueprint`: a fighter for a pad, any other ship for a slipway. */
export function asCraft(blueprint: Blueprint, kind: ModuleKind): ShipDesign | null {
    if ((blueprint.fighter === true) !== (kind === "pad")) return null;
    const design = compiledCraft(blueprint);
    return design !== null && design.fighter === (kind === "pad") ? design : null;
}

/** Everything a pad or slipway of `kind` could build: the ship itself, the fleet's, the library's, and any the hangar carries that none of those has. */
export function craftChoices(
    blueprint: Blueprint,
    kind: ModuleKind,
    library: Library<Blueprint>,
    inFleet: DesignInFleet | null,
): Map<string, Blueprint> {
    const choices = new Map<string, Blueprint>();
    if (asCraft(blueprint, kind) !== null) choices.set(blueprint.name, blueprint);
    // In a fleet, its own designs next: what a pad names there is the fleet's.
    for (const [name, design] of Object.entries(inFleet?.fleet.designs ?? {})) {
        if (!choices.has(name) && name !== inFleet?.design && asCraft(design, kind) !== null) choices.set(name, design);
    }
    for (const entry of library.list()) {
        if (choices.has(entry.name)) continue;
        let saved: Blueprint | null;
        try {
            saved = library.load(entry.name);
        } catch {
            continue;
        }
        if (saved !== null && entry.name !== blueprint.name && asCraft(saved, kind) !== null) choices.set(entry.name, saved);
    }
    for (const [name, design] of Object.entries(blueprint.hangar ?? {})) {
        if (!choices.has(name)) choices.set(name, design);
    }
    return choices;
}
