import { describe, expect, it } from "vitest";
import { Snapshot, type ShipView } from "../sim/index.js";
import { Poses } from "../render/poses.js";
import type { Pose } from "../render/vapour.js";

/** A picture of one leaking ship at `t`, at `x` and turned `angle`. */
function picture(t: number, x: number, angle: number): Snapshot {
    const snapshot = new Snapshot();
    snapshot.time = t;
    snapshot.shipCount = 1;
    snapshot.ships[0] = { body: 3, serial: 1, x, y: 0, angle, vx: 10, vy: 0, leakX: [0] } as unknown as ShipView;
    return snapshot;
}

describe("where a leaking ship has been", () => {
    it("is kept frame by frame, and found between two frames", () => {
        const poses = new Poses();
        poses.record(picture(0, 0, 0));
        poses.record(picture(1, 10, 0.5));
        const pose: Pose = { x: 0, y: 0, angle: 0, vx: 0, vy: 0 };
        expect(poses.at(3, 1, 0.5, pose)).toBe(true);
        expect(pose.x).toBeCloseTo(5, 9);
        expect(pose.angle).toBeCloseTo(0.25, 9);
        // Older than anything kept: the oldest.
        poses.at(3, 1, 5, pose);
        expect(pose.x).toBe(0);
    });

    it("turns the shorter way round between two frames", () => {
        const poses = new Poses();
        poses.record(picture(0, 0, Math.PI - 0.1));
        poses.record(picture(1, 0, -Math.PI + 0.1));
        const pose: Pose = { x: 0, y: 0, angle: 0, vx: 0, vy: 0 };
        poses.at(3, 1, 0.5, pose);
        expect(Math.abs(Math.cos(pose.angle) + 1)).toBeLessThan(1e-9);
    });

    it("forgets what came after a moment the battle is wound back to", () => {
        const poses = new Poses();
        poses.record(picture(0, 0, 0));
        poses.record(picture(1, 10, 0));
        poses.record(picture(2, 20, 0));
        poses.record(picture(1.5, 15, 0));
        const pose: Pose = { x: 0, y: 0, angle: 0, vx: 0, vy: 0 };
        poses.at(3, 1, 0, pose);
        expect(pose.x).toBe(15);
        poses.at(3, 1, 0.25, pose);
        expect(pose.x).toBeCloseTo(12.5, 9);
    });

    it("knows nothing of a ship it has not seen leak", () => {
        const pose: Pose = { x: 0, y: 0, angle: 0, vx: 0, vy: 0 };
        expect(new Poses().at(3, 1, 0, pose)).toBe(false);
    });
});
