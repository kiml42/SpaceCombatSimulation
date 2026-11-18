import { describe, expect, it } from "vitest";
import type { BattleView } from "~/host/battleView";
import { Snapshot, type ShipView } from "~/sim/index";
import { orderState } from "./orderState";

function shown(ships: ShipView[]): Snapshot {
    const snapshot = new Snapshot();
    snapshot.ships = ships;
    snapshot.shipCount = ships.length;
    return snapshot;
}

const view = (picked: number[]): BattleView => ({ picked, armed: null, orderSide: () => 0, sides: undefined }) as unknown as BattleView;

const miner = { ship: 0, body: 10, team: 0, currentStructure: { name: "Salvager" }, doing: "scavenge", doingTo: 11 } as ShipView;
const rock = { body: 11, team: -1, currentStructure: { name: "Asteroid" }, rock: { rock: 5000, ore: 1000, ice: 200 } } as ShipView;

describe("the asteroid card", () => {
    it("shows the asteroid a ship picked out alone is mining", () => {
        const state = orderState(view([0]), shown([miner, rock]));
        expect(state.asteroid).toMatch(/^rock 5\.00 t · ore 1\.00 t · ice 0\.200 t/);
        expect(state.mining).toBe(true);
    });

    it("shows nothing for a ship that is not mining", () => {
        const { doing: _doing, doingTo: _to, ...idle } = miner;
        expect(orderState(view([0]), shown([idle, rock])).asteroid).toBeNull();
    });
});
