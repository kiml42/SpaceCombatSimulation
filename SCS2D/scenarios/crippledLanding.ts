import { compileBlueprint, math, SHATTER, type Blueprint } from "../sim/index.js";
import { type Battle } from "./types.js";
import { makeBattle } from "./battle.js";
import { DINKY, REPLICATOR } from "./blueprints.js";

/**
 * Fighters deliberately crippled, each making for a carrier's pad low on fuel:
 * the kinds of damage a fighter used to be left hanging by its carrier with.
 * Eight at once, one to a carrier, each coming in from a different side, so a
 * way of coming in that only fails from some sides shows up in one battle.
 */

/** A carrier with a pad `length` long and `width` wide, and fuel, metal and charge to give. */
export function padCarrier(length: number, width: number): Blueprint {
    return {
        name: "Carrier",
        modules: [
            { kind: "core", x: 0, y: 0, length: 6, width: 6 },
            { kind: "tank", x: -13, y: 0, length: 20, width: 10 },
            { kind: "hold", x: 0, y: 6, length: 6, width: 6, fill: 1 },
            { kind: "generator", x: 0, y: -6, length: 6, width: 6 },
            { kind: "pad", x: 3 + length / 2, y: 0, length, width },
        ],
    };
}

const RAIDER = REPLICATOR.hangar!["Dinky Raider"]!;
const RAIDER_PAD = padCarrier(8.674634452, 7);
const DINKY_PAD = padCarrier(10, 10);

/** A way of crippling a fighter: which, which of its modules are shot away, and the carrier it makes for. */
export interface Crippling {
    readonly name: string;
    readonly fighter: Blueprint;
    readonly carrier: Blueprint;
    readonly lost: readonly number[];
    /** Modules blown off altogether, as a fighter often comes out of a battle, rather than left wrecked on it. */
    readonly blownOff?: readonly number[];
}

/**
 * Each damage the crippled landing tests ask about. A Dinky Raider's modules:
 * 1, 3, 7, 9 thrusters pushing it sideways, 2 and 8 pushing it back, 4 its
 * main, 6 its gun (half its mass, at the nose), 10 its hold. A Dinky's Side
 * thrusters and their opposite numbers: losing [2, 7, 8] or [1, 2, 9] leaves its turn one way only.
 * A Dinky's 2, 3, 8 and 9 are its forward thrusters, 6 its gun and 10 its hold: everything ahead of its tank.
 */
export const CRIPPLINGS: readonly Crippling[] = [
    { name: "Raider, one turn far weaker [1, 8]", fighter: RAIDER, carrier: RAIDER_PAD, lost: [1, 8] },
    { name: "Raider, one turn far weaker [3, 7]", fighter: RAIDER, carrier: RAIDER_PAD, lost: [3, 7] },
    { name: "Raider, no main [4]", fighter: RAIDER, carrier: RAIDER_PAD, lost: [4] },
    { name: "Raider, no main [2, 4]", fighter: RAIDER, carrier: RAIDER_PAD, lost: [2, 4] },
    { name: "Raider, pushes turn it [4, 6]", fighter: RAIDER, carrier: RAIDER_PAD, lost: [4, 6] },
    { name: "Raider, pushes turn it [4, 8, 10]", fighter: RAIDER, carrier: RAIDER_PAD, lost: [4, 8, 10] },
    { name: "Raider, turns one way, every push spins it [4, 7, 10]", fighter: RAIDER, carrier: RAIDER_PAD, lost: [4, 7, 10] },
    { name: "Raider, turns one way, every push spins it [1, 4, 10]", fighter: RAIDER, carrier: RAIDER_PAD, lost: [1, 4, 10] },
    { name: "Dinky, turns anticlockwise only [2, 7, 8]", fighter: DINKY, carrier: DINKY_PAD, lost: [2, 7, 8] },
    { name: "Dinky, turns clockwise only [1, 2, 9]", fighter: DINKY, carrier: DINKY_PAD, lost: [1, 2, 9] },
    // Its forward thrusters, gun and hold: what is left is its tank, core, main and the two Side thrusters astern.
    {
        name: "Dinky, nothing ahead of its tank [2, 3, 6, 8, 9, 10]",
        fighter: DINKY,
        carrier: DINKY_PAD,
        lost: [],
        blownOff: [2, 3, 6, 8, 9, 10],
    },
];

/** How many fighters come in at once, one from each eighth of the way round. */
export const APPROACHES = 8;
/** How far off its carrier each fighter starts, metres. */
const START = 360;
/** How far apart the carriers are, metres: far enough that each fighter's nearest pad is its own. */
const SPACING = 2500;

export type CrippledLanding = Battle & { readonly carriers: readonly number[]; readonly fighters: readonly number[] };

/** `APPROACHES` carriers in two rows, each with a fighter crippled as `crippling` says coming in from its own side. */
export function crippledLanding(seed = 20260905, crippling: Crippling = CRIPPLINGS[0]!): CrippledLanding {
    const doctrine = compileBlueprint(crippling.fighter).doctrine;
    // Low enough on fuel to go, and not sent by how whole it is, which would muddle what is being tested.
    const fighter = compileBlueprint({
        ...crippling.fighter,
        doctrine: { ...doctrine, approach: { ...doctrine.approach, refuelBelow: 0.5, repairBelow: 0 } },
    });
    const carrier = compileBlueprint(crippling.carrier);
    return makeBattle({ seed }, (ships, world) => {
        const carriers: number[] = [];
        const fighters: number[] = [];
        for (let k = 0; k < APPROACHES; k++) {
            const cx = (k % (APPROACHES / 2)) * SPACING;
            const cy = k < APPROACHES / 2 ? 0 : SPACING;
            carriers.push(ships.spawn(world, { design: carrier, x: cx, y: cy, angle: 0.3, team: 0 }));
            const from = (k * 2 * math.PI) / APPROACHES;
            const f = ships.spawn(world, {
                design: fighter,
                x: cx + math.cos(from) * START,
                y: cy + math.sin(from) * START,
                angle: from + 1,
                team: 0,
            });
            const b = world.bodies.indexOf(ships.body(f));
            for (let m = 0; m < fighter.modules.length; m++) ships.fuel.vent(b, m, ships.fuel.held(b, m) * 0.7);
            for (const m of crippling.lost) ships.damage.absorb(b, m, ships.damage.capacityLeft(b, m));
            // Enough at once to shatter it, so the first step takes it off the hull.
            for (const m of crippling.blownOff ?? []) ships.damage.absorb(b, m, SHATTER * ships.damage.capacityOf(b, m));
            fighters.push(f);
        }
        return { carriers, fighters };
    });
}
