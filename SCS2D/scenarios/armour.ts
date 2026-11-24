import { compileBlueprint, math, type Blueprint, type Placement } from "../sim/index.js";
import type { Battle } from "./types.js";
import { makeBattle } from "./battle.js";
import { BEAM_CORVETTE, CORVETTE, GUN_PLATFORM, KKV, LANCE_CORVETTE, RAIL_CORVETTE, SHAPED_TORPEDO, TORPEDO } from "./blueprints.js";

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

/** The reinforcement the Armour scene's Gun Platform is built to, from none to extreme: its stock plates are 3. */
export const ARMOUR_LEVELS: readonly number[] = [1, 3, 6, 12, 24];

/** Each kind of corvette, in the order the Armour scene's variants take them. */
export const ARMOUR_ATTACKERS: readonly (readonly [string, Blueprint])[] = [
    ["Corvette", CORVETTE],
    ["Beam Corvette", BEAM_CORVETTE],
    ["Rail Corvette", RAIL_CORVETTE],
    ["Lance Corvette", LANCE_CORVETTE],
    ["KKV", KKV],
    ["Torpedo", TORPEDO],
    ["Shaped Torpedo", SHAPED_TORPEDO],
];

/** How far off the platform's bow plate the corvette starts: inside every corvette's reach, the lance's included. */
const ARMOUR_RANGE = 250;

/**
 * One corvette of a kind against the Gun Platform, its broad structure plates
 * and every other module reinforced to `reinforcement`: what each kind of
 * weapon does to armour plating, and what gets through.
 *
 * No well, and the corvette starting in range at rest, its bow on the
 * platform's bow plate, so every setting fights the same fight.
 */
export function armour(seed = 20260905, corvette = 0, reinforcement = 6): Battle {
    return makeBattle({ seed }, (ships, world) => {
        const attacker = compileBlueprint(ARMOUR_ATTACKERS[corvette]![1]);
        const target = compileBlueprint(reinforced(GUN_PLATFORM, reinforcement));

        ships.spawn(world, { design: attacker, x: -ARMOUR_RANGE, y: 0, angle: 0, team: 0 });
        ships.spawn(world, { design: target, x: 0, y: 0, angle: math.PI, team: 1 });
    });
}
