import { expect, test } from "vitest";
import { BLUEPRINTS } from "~/scenarios/blueprints";
import { battleRoute, shipFleet } from "~/editor/handoff";
import { serialiseFleet } from "~/sim/index";
import { routeOfLegacyHash } from "./legacyLinks";

test("an old shared battle link opens the Simulator, its battle unchanged", () => {
    expect(routeOfLegacyHash("#battle=abc-_123")).toBe("#/simulator?battle=abc-_123");
});

test("an old handed fleet opens the Simulator, and reads back as the fleet", () => {
    const fleet = shipFleet(Object.values(BLUEPRINTS)[0]!);
    const old = `#fleet=${encodeURIComponent(JSON.stringify(serialiseFleet(fleet)))}`;
    const route = routeOfLegacyHash(old)!;
    const search = new URLSearchParams(route.slice(route.indexOf("?")));
    expect(JSON.parse(search.get("fleet")!)).toEqual(serialiseFleet(fleet));
});

test("an editor's Test in Simulator link opens the Simulator directly", () => {
    const fleet = shipFleet(Object.values(BLUEPRINTS)[0]!);
    const href = battleRoute(fleet);
    expect(href.startsWith("/simulator?fleet=")).toBe(true);
    expect(JSON.parse(new URLSearchParams(href.slice(href.indexOf("?"))).get("fleet")!)).toEqual(serialiseFleet(fleet));
});

test("any other hash is left to the router", () => {
    expect(routeOfLegacyHash("")).toBeNull();
    expect(routeOfLegacyHash("#/library")).toBeNull();
});
