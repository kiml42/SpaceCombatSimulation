import { describe, expect, it } from "vitest";
import { MOST_TILES, stripsFor, stripTileAt, type StripShip } from "../render/fleetStrip.js";
import { Snapshot, type ShipView } from "../sim/index.js";
import { fleetStrips } from "../render/canvas2d.js";
import { capture } from "../sim/snapshot.js";
import { beamCarrier } from "../scenarios/beamCarrier.js";

const W = 1000;
const H = 600;
const SETTINGS = { largest: 80, smallest: 30, margin: 6, gap: 4 };

function ship(body: number, team: number, radius = 20): StripShip {
    return { body, team, x: body * 100, y: 0, vx: 0, vy: 0, radius };
}

describe("the fleets down the edges", () => {
    it("puts even sides on the left and odd on the right, in the order given", () => {
        const strips = stripsFor([ship(1, 0), ship(2, 1), ship(3, 0), ship(4, 3)], W, H, SETTINGS);
        expect(strips.left.tiles.map((tile) => tile.body)).toEqual([1, 3]);
        expect(strips.right.tiles.map((tile) => tile.body)).toEqual([2, 4]);
        expect(strips.left.tiles[0]!.x).toBe(SETTINGS.margin);
        expect(strips.right.tiles[0]!.x + strips.right.tiles[0]!.size).toBe(W - SETTINGS.margin);
    });

    it("stacks a column down from the top, at its largest when few", () => {
        const [a, b] = stripsFor([ship(1, 0), ship(2, 0)], W, H, SETTINGS).left.tiles;
        expect(a!.size).toBe(SETTINGS.largest);
        expect(a!.y).toBe(SETTINGS.margin);
        expect(b!.y).toBe(SETTINGS.margin + SETTINGS.largest + SETTINGS.gap);
    });

    it("shrinks tiles to fit a column, and says how many more there are past the smallest", () => {
        const many = Array.from({ length: 40 }, (_, k) => ship(k, 0));
        const column = stripsFor(many, W, H, SETTINGS).left;
        expect(column.tiles[0]!.size).toBe(SETTINGS.smallest);
        expect(column.tiles.length + column.hidden).toBe(40);
        expect(column.more).not.toBeNull();
        // Everything, the count included, inside the view.
        expect(column.more!.y + column.more!.size).toBeLessThanOrEqual(H);
        const twelve = stripsFor(many.slice(0, 12), W, H, SETTINGS).left;
        expect(twelve.hidden).toBe(0);
        expect(twelve.tiles.at(-1)!.y + twelve.tiles.at(-1)!.size).toBeLessThanOrEqual(H - SETTINGS.margin + 0.001);
    });

    it("takes no width for a side with no ships", () => {
        const strips = stripsFor([ship(1, 0)], W, H, SETTINGS);
        expect(strips.right.width).toBe(0);
        expect(strips.left.width).toBe(SETTINGS.largest + SETTINGS.margin);
    });

    it("frames each ship in its own tile, zoomed to it", () => {
        const tile = stripsFor([ship(3, 0, 40)], W, H, SETTINGS).left.tiles[0]!;
        expect(tile.camera).toMatchObject({ x: 300, y: 0 });
        expect(2 * 40 * tile.camera.scale).toBeLessThan(tile.size);
    });

    it("finds the tile under a point", () => {
        const strips = stripsFor([ship(1, 0), ship(2, 1)], W, H, SETTINGS);
        expect(stripTileAt(strips, SETTINGS.margin + 5, SETTINGS.margin + 5)).toBe(1);
        expect(stripTileAt(strips, W - SETTINGS.margin - 5, SETTINGS.margin + 5)).toBe(2);
        expect(stripTileAt(strips, W / 2, H / 2)).toBe(-1);
    });

    const kind = (body: number, team: number, design: number, intact = 1): StripShip => ({ ...ship(body, team), design, intact });

    it(`gives every ship a tile of its own while there are no more than ${MOST_TILES}`, () => {
        const few = Array.from({ length: MOST_TILES }, (_, k) => kind(k, 0, 0));
        expect(stripsFor(few, W, H, SETTINGS).left.tiles.map((tile) => tile.count)).toEqual(Array(MOST_TILES).fill(1));
    });

    it("past that, shares a tile among the commonest design first, fighter or not, until few enough", () => {
        // Six of design 0, three of 1, two of 2: grouping 0 leaves 1 + 3 + 2 = 6, so 1 goes too.
        const fleet = [
            kind(1, 0, 1),
            kind(2, 0, 0),
            kind(3, 0, 2),
            kind(4, 0, 0, 2),
            kind(5, 0, 1),
            kind(6, 0, 0),
            kind(7, 0, 2),
            kind(8, 0, 0),
            kind(9, 0, 1),
            kind(10, 0, 0),
            kind(11, 0, 0, 2),
        ];
        const tiles = stripsFor(fleet, W, H, SETTINGS).left.tiles;
        // Each shared tile where its first ship was, showing the least damaged, the lowest body of equals.
        expect(tiles.map((tile) => [tile.body, tile.count])).toEqual([
            [1, 3],
            [4, 6],
            [3, 1],
            [7, 1],
        ]);
        expect(tiles[1]!.bodies).toEqual([2, 4, 6, 8, 10, 11]);
    });

    it("stops when every tile is a design of its own, however many there are", () => {
        const fleet = [...Array.from({ length: 8 }, (_, k) => kind(k, 0, k)), kind(8, 0, 0), ship(9, 0), ship(10, 0)];
        const tiles = stripsFor(fleet, W, H, SETTINGS).left.tiles;
        expect(tiles.map((tile) => tile.count)).toEqual([2, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    });

    it("never shares a tile between sides on the same edge", () => {
        const fleet = [...Array.from({ length: 3 }, (_, k) => kind(k, 0, 0)), ...Array.from({ length: 3 }, (_, k) => kind(10 + k, 2, 0))];
        expect(stripsFor(fleet, W, H, SETTINGS).left.tiles.map((tile) => [tile.team, tile.count])).toEqual([
            [0, 3],
            [2, 1],
            [2, 1],
            [2, 1],
        ]);
    });

    it("counts the ships in a tile that did not fit among those left out", () => {
        const many = Array.from({ length: 40 }, (_, k) => ship(k, 0));
        const fighters = Array.from({ length: 5 }, (_, k): StripShip => ({ ...ship(100 + k, 0, 5), design: 0, intact: 1 }));
        const column = stripsFor([...many, ...fighters], W, H, SETTINGS).left;
        expect(column.tiles.length + column.hidden).toBe(45);
    });
});

describe("the fleet strips of a battle", () => {
    it("give a side one tile for its ships of a design, however damaged each is", () => {
        const tie = {
            radius: 5,
            name: "TIE",
            fighter: true,
            modules: [],
            turrets: [],
            engines: [],
            weaponEngines: [],
            mainWeaponEngines: [],
        } as unknown as ShipView["currentStructure"];
        const knocked = { ...tie } as ShipView["currentStructure"];
        const fighter = (body: number, design: ShipView["currentStructure"]): ShipView =>
            ({
                currentStructure: design,
                blueprint: tie,
                body,
                ship: body,
                team: 0,
                serial: body,
                x: body * 20,
                y: 0,
                angle: 0,
                vx: 0,
                vy: 0,
                hasControl: true,
                integrity: [],
                turretBearings: [],
                turretReady: [],
            }) as unknown as ShipView;
        const picture = new Snapshot();
        picture.ships = Array.from({ length: MOST_TILES + 1 }, (_, k) => fighter(k, k === 0 ? tie : knocked));
        picture.shipCount = MOST_TILES + 1;
        const strips = fleetStrips(picture, 1000, 600);
        expect(strips.left.tiles.map((tile) => tile.count)).toEqual([MOST_TILES + 1]);
    });

    it("show the least damaged of a shared tile's ships, by the mass of what is left of each", () => {
        const design = { radius: 5, name: "Corvette", mass: 100, modules: [{}, {}] } as unknown as ShipView["currentStructure"];
        const lost = { ...design, mass: 60, modules: [{}] } as unknown as ShipView["currentStructure"];
        const corvette = (body: number, structure: ShipView["currentStructure"], integrity: number[]): ShipView =>
            ({
                currentStructure: structure,
                body,
                ship: body,
                team: 0,
                x: 0,
                y: 0,
                vx: 0,
                vy: 0,
                hasControl: true,
                integrity,
            }) as unknown as ShipView;
        const picture = new Snapshot();
        picture.ships = [
            ...Array.from({ length: MOST_TILES }, (_, k) => corvette(k, design, [0.5, 1])),
            corvette(MOST_TILES, lost, [1]),
            corvette(MOST_TILES + 1, design, [1, 0.9]),
        ];
        picture.shipCount = MOST_TILES + 2;
        expect(fleetStrips(picture, 1000, 600).left.tiles.map((tile) => tile.body)).toEqual([MOST_TILES + 1]);
    });

    it("puts a carrier's fighters from every pad on one tile, though each pad compiled its own copy of the design", () => {
        const run = beamCarrier();
        run.step();
        const picture = capture(new Snapshot(), run.world, run.ships, run.projectiles, run.beams);
        const strips = fleetStrips(picture, 1000, 2000);
        const tiles = [...strips.left.tiles, ...strips.right.tiles];
        const dinkies = picture.ships.slice(0, picture.shipCount).filter((v) => v.blueprint?.name === "Dinky Beam" && v.hasControl);
        expect(dinkies.length).toBeGreaterThan(1);
        const bodies = new Set(dinkies.map((v) => v.body));
        expect(tiles.filter((tile) => bodies.has(tile.body))).toHaveLength(1);
        expect(tiles.find((tile) => bodies.has(tile.body))!.count).toBe(dinkies.length);
        expect(tiles.find((tile) => bodies.has(tile.body))!.bodies.length).toBe(dinkies.length);
    });
});
