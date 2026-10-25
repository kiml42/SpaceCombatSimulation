import { expect, it } from "vitest";
import { compileBlueprint, type Blueprint } from "../sim/index.js";
import { makeBattle } from "../scenarios/battle.js";
import { give } from "../scenarios/commands.js";
import { DINKY, SALVAGER } from "../scenarios/blueprints.js";

// A ship that keeps out of nobody's way, so only the rammer can.
const STEADY: Blueprint = { ...SALVAGER, doctrine: { ...SALVAGER.doctrine!, approach: { ...SALVAGER.doctrine!.approach, separation: 0 } } };

it("keeps a ram clear of a friend in its way", () => {
    const run = makeBattle({ seed: 1, projectiles: 64, beams: 16 }, (ships, world) => {
        const rammer = ships.spawn(world, { design: compileBlueprint(DINKY), x: -400, y: 0, angle: 0, team: 0 });
        const friend = ships.spawn(world, { design: compileBlueprint(STEADY), x: -100, y: 0, angle: Math.PI / 2, team: 0 });
        ships.spawn(world, { design: compileBlueprint(STEADY), x: 200, y: 0, angle: Math.PI / 2, team: 1 });
        return { rammer, friend };
    });
    give(run, { kind: "order", ships: [run.rammer], order: { kind: "ram", target: 2 }, append: false });
    const b = run.world.bodies;
    const c = run.collisions.contacts;
    let rammed = false;
    for (let t = 0; t < 20 * 60; t++) {
        run.step();
        rammed ||= run.ships.doingOf(run.rammer)?.kind === "ram";
        const rb = b.indexOf(run.ships.body(run.rammer));
        const fb = b.indexOf(run.ships.body(run.friend));
        for (let k = 0; k < c.count; k++) expect((c.a[k] === rb && c.b[k] === fb) || (c.a[k] === fb && c.b[k] === rb)).toBe(false);
    }
    expect(rammed).toBe(true);
});
