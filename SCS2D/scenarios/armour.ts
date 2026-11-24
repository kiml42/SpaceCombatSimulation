import { compileBlueprint, math, type Blueprint, type Placement } from "../sim/index.js";
import type { Battle } from "./types.js";
import { CROSSING, SIDE_WELL, makeBattle } from "./battle.js";
import { BEAM_CORVETTE, CORVETTE, GUNSHIP, LANCE_CORVETTE, RAIL_CORVETTE } from "./blueprints.js";

/** How many times over the Armoured Gunship's walls are reinforced. */
const ARMOUR = 4;

/** `from` with every module's walls reinforced `times` over: the same ship, far better armoured and heavier. */
function armoured(from: Blueprint, times: number, name: string): Blueprint {
    const thicken = (modules: readonly Placement[]): Placement[] =>
        modules.map((m) => ("kind" in m ? { ...m, reinforcement: Math.max(1, m.reinforcement ?? 1) * times } : m));
    return {
        ...from,
        name,
        modules: thicken(from.modules),
        assemblies: Object.fromEntries(
            Object.entries(from.assemblies ?? {}).map(([key, a]) => [key, { ...a, modules: thicken(a.modules) }]),
        ),
    };
}

/** The Gunship with its walls four times as thick. */
export const ARMOURED_GUNSHIP: Blueprint = armoured(GUNSHIP, ARMOUR, "Armoured Gunship");

/** Each kind of corvette, in the order the Armour scene's variants take them. */
export const ARMOUR_CORVETTES: readonly (readonly [string, Blueprint])[] = [
    ["Corvettes", CORVETTE],
    ["Beam Corvettes", BEAM_CORVETTE],
    ["Rail Corvettes", RAIL_CORVETTE],
    ["Lance Corvettes", LANCE_CORVETTE],
];

/**
 * Two corvettes of one kind against a heavily armoured gunship, or against the
 * same gunship unarmoured, laid out as the duel is: what armour stops of each
 * kind of weapon, and what gets through.
 */
export function armour(seed = 20260905, corvette = 0, armouredGunship = true): Battle {
    return makeBattle({ seed, wells: [SIDE_WELL] }, (ships, world) => {
        const attacker = compileBlueprint(ARMOUR_CORVETTES[corvette]![1]);
        const target = compileBlueprint(armouredGunship ? ARMOURED_GUNSHIP : GUNSHIP);

        ships.spawn(world, { design: attacker, ...CROSSING.west, team: 0 });
        ships.spawn(world, { design: attacker, x: 2000, y: -740, angle: math.HALF_PI / 2, vx: 0, vy: 90, team: 0 });
        ships.spawn(world, { design: target, ...CROSSING.east, team: 1 });
    });
}
