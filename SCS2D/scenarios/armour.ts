import { compileBlueprint, math, type Blueprint, type Placement } from "../sim/index.js";
import type { Battle } from "./types.js";
import { CROSSING, SIDE_WELL, makeBattle } from "./battle.js";
import { BEAM_CORVETTE, CORVETTE, GUN_PLATFORM, LANCE_CORVETTE, RAIL_CORVETTE } from "./blueprints.js";

/** `from` with every module's walls reinforced `reinforcement` times: its armour plates and all the rest. */
function reinforced(from: Blueprint, reinforcement: number): Blueprint {
    const set = (modules: readonly Placement[]): Placement[] => modules.map((m) => ("kind" in m ? { ...m, reinforcement } : m));
    return {
        ...from,
        name: `${from.name}, reinforced ${reinforcement}`,
        modules: set(from.modules),
        assemblies: Object.fromEntries(Object.entries(from.assemblies ?? {}).map(([key, a]) => [key, { ...a, modules: set(a.modules) }])),
    };
}

/** The reinforcement the Armour scene's Gun Platform is built to, from none to heavy: its stock plates are 3. */
export const ARMOUR_LEVELS: readonly number[] = [1, 3, 6];

/** Each kind of corvette, in the order the Armour scene's variants take them. */
export const ARMOUR_CORVETTES: readonly (readonly [string, Blueprint])[] = [
    ["Corvettes", CORVETTE],
    ["Beam Corvettes", BEAM_CORVETTE],
    ["Rail Corvettes", RAIL_CORVETTE],
    ["Lance Corvettes", LANCE_CORVETTE],
];

/**
 * Two corvettes of one kind against the Gun Platform, its broad structure
 * plates and every other module reinforced to `reinforcement`, laid out as the
 * duel is: what each kind of weapon does to armour plating, and what gets through.
 */
export function armour(seed = 20260905, corvette = 0, reinforcement = 6): Battle {
    return makeBattle({ seed, wells: [SIDE_WELL] }, (ships, world) => {
        const attacker = compileBlueprint(ARMOUR_CORVETTES[corvette]![1]);
        const target = compileBlueprint(reinforced(GUN_PLATFORM, reinforcement));

        ships.spawn(world, { design: attacker, ...CROSSING.west, team: 0 });
        ships.spawn(world, { design: attacker, x: 2000, y: -740, angle: math.HALF_PI / 2, vx: 0, vy: 90, team: 0 });
        ships.spawn(world, { design: target, ...CROSSING.east, team: 1 });
    });
}
