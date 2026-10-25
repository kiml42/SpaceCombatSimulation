import { describe, expect, it } from "vitest";
import { checksumWorld } from "../sim/checksum.js";
import { duel } from "../scenarios/duel.js";
import { Rewind } from "../scenarios/rewind.js";

const stepped = (steps: number): number => {
    const battle = duel();
    for (let i = 0; i < steps; i++) battle.step();
    return checksumWorld(battle.world);
};

describe("rewind", () => {
    it("winds back to the same state as a battle fought only that far, and on again", () => {
        const rewind = new Rewind(duel());
        rewind.seek(300);
        expect(rewind.seek(120)).toBe(true);
        expect(rewind.at).toBe(120);
        expect(rewind.reached).toBe(300);
        expect(checksumWorld(rewind.battle.world)).toBe(stepped(120));
        expect(rewind.seek(250)).toBe(true);
        expect(checksumWorld(rewind.battle.world)).toBe(stepped(250));
    });

    it("winds back as exactly once its checkpoints have thinned", () => {
        const rewind = new Rewind(duel());
        rewind.seek(4000);
        expect(rewind.seek(1234)).toBe(true);
        expect(checksumWorld(rewind.battle.world)).toBe(stepped(1234));
    }, 60_000);

    it("winds back exactly when a clock spaces its checkpoints unevenly", () => {
        const rewind = new Rewind(duel(), () => performance.now());
        rewind.seek(900);
        for (const to of [777, 31, 650, 899]) {
            rewind.seek(to);
            expect(checksumWorld(rewind.battle.world)).toBe(stepped(to));
        }
    }, 60_000);

    it("snaps to a checkpoint or the furthest step reached", () => {
        const rewind = new Rewind(duel());
        rewind.seek(100);
        expect(rewind.snap(40)).toBe(30);
        expect(rewind.snap(50)).toBe(60);
        expect(rewind.snap(97)).toBe(100);
    });

    it("keeps the recent past dense and the distant past sparse", () => {
        const rewind = new Rewind(duel());
        rewind.seek(6000);
        const kept = rewind.kept;
        const gap = (back: number): number => {
            const i = kept.findIndex((step) => step >= 6000 - back);
            return kept[i]! - kept[i - 1]!;
        };
        expect(gap(120)).toBe(30);
        expect(gap(3000)).toBeGreaterThanOrEqual(120);
        expect(gap(3000)).toBeLessThanOrEqual(300);
        expect(kept[0]).toBe(0);
        expect(kept.length).toBeLessThan(60);
    }, 60_000);

    it("hands over a copy with nothing left over to draw, and each step it takes on", () => {
        const rewind = new Rewind(duel());
        rewind.battle.impacts.log.watched = true;
        rewind.seek(200);
        // Watched and never drained, the log has held every hit since the start.
        expect(rewind.battle.impacts.log.count).toBeGreaterThan(0);
        let restored = 0;
        let leftOver = -1;
        const steps: number[] = [];
        const seen = rewind.seek(
            100,
            () => {
                restored++;
                leftOver = rewind.battle.impacts.log.count;
            },
            () => steps.push(rewind.at),
        );
        expect(seen).toBe(true);
        expect(restored).toBe(1);
        expect(leftOver).toBe(0);
        expect(steps).toEqual([91, 92, 93, 94, 95, 96, 97, 98, 99, 100]);
        expect(rewind.kept).toContain(90);
    });

    it("hands back what the viewer kept with the checkpoint it restores", () => {
        let taken = 0;
        const rewind = new Rewind(duel(), undefined, [], (battle) => ({ step: battle.world.tick, taken: ++taken }));
        rewind.seek(100);
        let kept: { step: number; taken: number } | undefined;
        rewind.seek(65, (k) => (kept = k));
        expect(kept).toEqual({ step: 60, taken: 3 });
        // An order at a checkpoint replaces its copy, not what was kept with it.
        rewind.seek(90);
        rewind.issue({ kind: "stop", ships: [0] });
        rewind.seek(95);
        rewind.seek(90, (k) => (kept = k));
        expect(kept).toEqual({ step: 90, taken: 4 });
        expect(taken).toBe(4);
    });

    it("goes forward without rebuilding, and back to the furthest step reached", () => {
        const rewind = new Rewind(duel());
        rewind.seek(50);
        const battle = rewind.battle;
        expect(rewind.seek(80)).toBe(false);
        expect(rewind.battle).toBe(battle);
        rewind.seek(10);
        rewind.seek(rewind.reached);
        expect(checksumWorld(rewind.battle.world)).toBe(stepped(80));
    });
});
