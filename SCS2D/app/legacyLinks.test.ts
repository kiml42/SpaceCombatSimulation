import { expect, test } from "vitest";
import { BLUEPRINTS } from "~/scenarios/blueprints";
import { battleHref, shipFleet } from "~/editor/handoff";
import { serialiseFleet } from "~/sim/index";
import { routeOfLegacyHash } from "./legacyLinks";

test("an old shared battle link opens the battle route, its battle unchanged", () => {
    expect(routeOfLegacyHash("#battle=abc-_123")).toBe("#/battle?battle=abc-_123");
});

test("an old handed fleet opens the battle route, and reads back as the fleet", () => {
    const fleet = shipFleet(Object.values(BLUEPRINTS)[0]!);
    const old = `#fleet=${encodeURIComponent(JSON.stringify(serialiseFleet(fleet)))}`;
    const route = routeOfLegacyHash(old)!;
    const search = new URLSearchParams(route.slice(route.indexOf("?")));
    expect(JSON.parse(search.get("fleet")!)).toEqual(serialiseFleet(fleet));
});

test("an editor's Battle link opens the battle route directly", () => {
    const fleet = shipFleet(Object.values(BLUEPRINTS)[0]!);
    const href = battleHref(fleet);
    expect(href.startsWith("index.html#/battle?fleet=")).toBe(true);
    expect(JSON.parse(new URLSearchParams(href.slice(href.indexOf("?"))).get("fleet")!)).toEqual(serialiseFleet(fleet));
});

test("any other hash is left to the router", () => {
    expect(routeOfLegacyHash("")).toBeNull();
    expect(routeOfLegacyHash("#/library")).toBeNull();
});
