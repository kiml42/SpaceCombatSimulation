import type { DesignInFleet } from "~/editor/handoff";
import type { Library } from "~/editor/library";
import {
    barrelCalibres,
    blueprintProblem,
    compileDraft,
    CORE_COMPUTING_SHARE,
    TRAVERSE_GEAR_FRACTION,
    CORE_SHARE_DEFAULTS,
    CORE_SHARE_KEYS,
    type CoreShareKey,
    DEFAULT_BURST_SPEED,
    DEFAULT_FRAGMENTS,
    drainPriorityOf,
    DEFAULT_WARHEAD_FRAGMENTS,
    DEFAULT_WARHEAD_SPREAD,
    DEFAULT_FUSE,
    DEFAULT_NOZZLE_WIDTHS,
    masksWholeArc,
    math,
    mountTraverse,
    radiansToDegrees,
    type Blueprint,
    type ModuleKind,
    type ModuleSpec,
    type Placement,
    type ShipDesign,
    type ShipModuleKind,
    partPriority,
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

/** The kinds a ship is built of, but its core, in the groups the editor offers them in. */
export const MODULE_GROUPS: readonly { title: string; kinds: readonly { kind: ShipModuleKind; label: string; title?: string }[] }[] = [
    {
        title: "Structural",
        kinds: [
            { kind: "structure", label: "Structure" },
            { kind: "tank", label: "Tank" },
            { kind: "hold", label: "Hold", title: "A box of metal that the guns on its piece of hull load their rounds from" },
        ],
    },
    {
        title: "Power",
        kinds: [
            {
                kind: "generator",
                label: "Generator",
                title: "A plant that makes power for as long as it works, filling the batteries on its piece of hull",
            },
            {
                kind: "battery",
                label: "Battery",
                title: "A store of charge, filled by generators and drawn on by beams. Holds more the bigger it is, and passes power faster the more edge it has",
            },
            {
                kind: "robotBay",
                label: "Robot bay",
                title: "Berths for robots that crawl the hull mending damage, carrying out metal and charge from this piece of hull and coming back for more. Berths more the bigger it is",
            },
        ],
    },
    { title: "Propulsion", kinds: [{ kind: "engine", label: "Engine" }] },
    {
        title: "Weapons",
        kinds: [
            { kind: "turret", label: "Turret" },
            { kind: "beamTurret", label: "Beam turret" },
            { kind: "hullGun", label: "Hull gun" },
            {
                kind: "railGun",
                label: "Rail gun",
                title: "A hull gun whose rails throw solid shot twice as fast, on power rather than fuel. It does not train: the hull aims it",
            },
            { kind: "hullBeam", label: "Hull beam" },
            {
                kind: "plasmaLance",
                label: "Plasma lance",
                title: "Two prongs that throw a pulse of fuel, white hot, a short way and hard. Wider hits harder on more fuel; longer reaches further on more power. It kicks back as it fires",
            },
            {
                kind: "warhead",
                label: "Warhead",
                title: "A tank in a steel casing, its fuel the charge and burnt only once every other tank is dry, set off when an enemy comes within its fire range. Its casing flies out as fragments across its spread, and what the charge does not throw into them goes into the ship carrying it, throwing what it shatters",
            },
        ],
    },
    {
        title: "Docking",
        kinds: [
            { kind: "claw", label: "Claw", title: "Jaws and a pump on the bow, to drink from wrecks and disarmed enemies" },
            { kind: "pad", label: "Pad", title: "A deck a friendly fighter lands on, to be filled from this ship's tanks" },
            {
                kind: "port",
                label: "Port",
                title: "A coupling on the hull's side, to dock face to face with a friend's port and share fuel",
            },
            {
                kind: "slipway",
                label: "Slipway",
                title: "A shipyard in the hull, building the ship it names bow first out of its face, from this ship's metal and charge",
            },
        ],
    },
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
    // Its rails along a block long enough to load from, and a little way out past it.
    railGun: { kind: "railGun", angle: 0, length: 6, width: 4, barrels: 1, barrelCalibres: 10 },
    hullBeam: { kind: "hullBeam", angle: 0, length: 4, width: 4, barrels: 1 },
    // Long enough for its field to reach a fight's width, and a deck wide.
    plasmaLance: { kind: "plasmaLance", angle: 0, length: 6, width: 3 },
    claw: { kind: "claw", angle: 0, length: 2, width: 2 },
    // A torpedo's nose, throwing its fragments ahead of it.
    warhead: { kind: "warhead", angle: 0, length: 1, width: 0.5 },
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
    | "bore"
    | "traverse"
    | "turning"
    | "fuse"
    | "fragments"
    | "burstSpeed"
    | "spread"
    | "sealing"
    | "drainPriority"
    | "priority"
    | "fill"
    | "computing"
    | CoreShareKey
    | "robotsPerBerth"
    | "keep";

/** A unit conversion without its floating-point tail: 7% stored as 0.07 shows as 7, not 7.000000000000001. */
function tidy(value: number): number {
    return Number(value.toPrecision(12));
}

/** A module's own value for a field, with the default the parser would have applied. */
export function moduleField(spec: ModuleSpec, key: ModuleNumberField): number {
    if (key === "angle") return radiansToDegrees(spec.angle ?? 0);
    if (key === "reinforcement") return spec.reinforcement ?? 1;
    if (key === "nozzle") return spec.nozzle ?? DEFAULT_NOZZLE_WIDTHS;
    if (key === "barrelCalibres") return barrelCalibres(spec);
    if (key === "bore") return spec.bore ?? 1;
    // What the mount would do if the layout said nothing, so the box shows the
    // arc it actually has rather than a blank.
    // Worked out from the mount's shape where the layout gives none, so to a tenth of a degree.
    if (key === "traverse") return Math.round(radiansToDegrees(mountTraverse(spec)) * 10) / 10;
    if (key === "turning") return tidy((spec.turning ?? TRAVERSE_GEAR_FRACTION) * 100);
    if (key === "fuse") return spec.fuse ?? DEFAULT_FUSE;
    if (key === "fragments") return spec.fragments ?? (spec.kind === "warhead" ? DEFAULT_WARHEAD_FRAGMENTS : DEFAULT_FRAGMENTS);
    if (key === "spread") return tidy(radiansToDegrees(spec.spread ?? DEFAULT_WARHEAD_SPREAD));
    if (key === "burstSpeed") return spec.burstSpeed ?? DEFAULT_BURST_SPEED;
    // Millimetres on the panel, metres in the layout.
    if (key === "sealing") return tidy((spec.sealing ?? 0) * 1000);
    if (key === "drainPriority") return drainPriorityOf(spec);
    if (key === "priority") return partPriority(spec);
    // Per cent on the panel, a share in the layout.
    if (key === "fill") return tidy((spec.fill ?? 1) * 100);
    if (key === "computing") return tidy((spec.computing ?? CORE_COMPUTING_SHARE) * 100);
    // What it is weighted at when it steps in by default.
    const store = (CORE_SHARE_KEYS as readonly string[]).indexOf(key);
    if (store >= 0) return spec[key as CoreShareKey] ?? CORE_SHARE_DEFAULTS[store]!;
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

/** What flies but does nothing: a module out of every core's reach, and a gun that can only point at its own ship. */
export function reachWarnings(design: ShipDesign | null): string[] {
    const out: string[] = [];
    design?.coveredBy?.forEach((cores, m) => {
        if (cores === null || cores.length > 0) return;
        const module = design.modules[m]!;
        out.push(`module ${module.index} (${module.spec.kind}) is out of every core's reach, so it will not work`);
    });
    for (const turret of design?.turrets ?? []) {
        const mount = turret.mount;
        if (!masksWholeArc(mount.mask ?? [], mount.leftArc ?? math.PI, mount.rightArc ?? math.PI)) continue;
        const module = design!.modules[turret.module]!;
        out.push(`module ${module.index} (${module.spec.kind}) can only point where its own ship is in the way, so it will never fire`);
    }
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
            saved = library.load(entry.key);
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

/** A reason as a sentence's start: "a fighter cannot…" to "A fighter cannot…". */
export function sentence(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
}
