import { describe, expect, it } from "vitest";
import { compileBlueprint, math } from "../sim/index.js";
import { attackHeading } from "../sim/shipFlight.js";
import { makeBattle } from "../scenarios/battle.js";
import { GUNSHIP, LANCE_CORVETTE } from "../scenarios/blueprints.js";

/** A Lance Corvette at the origin, facing a Gunship lying across its bow 300 m off. */
function scene() {
    const run = makeBattle({ seed: 1, pilots: false }, (ships, world) => ({
        corvette: ships.spawn(world, { design: compileBlueprint(LANCE_CORVETTE), x: 0, y: 0, angle: 0, team: 0 }),
        gunship: ships.spawn(world, { design: compileBlueprint(GUNSHIP), x: 300, y: 0, angle: math.PI / 2, team: 1 }),
    }));
    const bodies = run.world.bodies;
    const b = bodies.indexOf(run.ships.body(run.corvette));
    const tb = bodies.indexOf(run.ships.body(run.gunship));
    const lance = run.ships.designs[run.corvette]!.turrets.findIndex((t) => t.gun.plasmaReach > 0);
    return { run, bodies, b, tb, lance };
}

describe("a hull aimed by its guns", () => {
    it("points at the part of its target its fixed main gun is after, not at the target's middle", () => {
        const { run, bodies, b, tb, lance } = scene();
        const ships = run.ships;
        const design = ships.designs[run.gunship]!;
        // The module furthest along the Gunship from its middle: well off the line to its centre.
        let part = 0;
        for (let k = 0; k < design.modules.length; k++) {
            if (Math.abs(design.modules[k]!.x) > Math.abs(design.modules[part]!.x)) part = k;
        }
        const at = ships.locate(bodies, run.gunship, tb, ships.fightAt);
        const towards = Math.atan2(at.y - bodies.y[b]!, at.x - bodies.x[b]!);
        const whole = attackHeading(ships, run.corvette, b, at, bodies, towards, run.gunship, tb);

        ships.turretAiming[run.corvette]![lance] = run.gunship;
        ships.turretAimModule[run.corvette]![lance] = part;
        const aimed = attackHeading(ships, run.corvette, b, at, bodies, towards, run.gunship, tb);

        const angle = bodies.angle[tb]!;
        const m = design.modules[part]!;
        const px = bodies.x[tb]! + m.x * Math.cos(angle) - m.y * Math.sin(angle);
        const py = bodies.y[tb]! + m.x * Math.sin(angle) + m.y * Math.cos(angle);
        // At rest, so there is no lead: straight at the part, and not where the whole ship is.
        expect(aimed).toBeCloseTo(Math.atan2(py - bodies.y[b]!, px - bodies.x[b]!), 6);
        expect(Math.abs(aimed - whole)).toBeGreaterThan(0.01);
    });

    it("points at the whole ship where its guns are after no part of it", () => {
        const { run, bodies, b, tb } = scene();
        const ships = run.ships;
        const at = ships.locate(bodies, run.gunship, tb, ships.fightAt);
        const towards = Math.atan2(at.y - bodies.y[b]!, at.x - bodies.x[b]!);
        expect(attackHeading(ships, run.corvette, b, at, bodies, towards, run.gunship, tb)).toBeCloseTo(towards, 6);
    });
});
