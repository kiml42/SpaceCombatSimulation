import { useMemo } from "react";
import { useSampled } from "~/features/battle/useSampled";
import type { BattleView, Verb } from "~/host/battleView";
import { teamName } from "~/render/teams";
import { viewOf } from "~/render/picking";
import type { OrderView, Snapshot } from "~/sim/index";

/** What the order controls show, read off the battle: plain data, so it can be compared as text. */
export interface OrderState {
    /** The side the picked ships take orders for, or null when none can be told. */
    readonly side: number | null;
    readonly picked: readonly number[];
    readonly armed: Verb | null;
    /** What one ship picked out alone has been told, each order described, or null. */
    readonly queue: { readonly ship: number; readonly orders: readonly string[] } | null;
    /** What the picked ships are built to, and whether all have robots to rebuild themselves. */
    readonly designs: readonly string[];
    readonly crewed: boolean;
    /** The approach speed they share, as the hold speed's placeholder. */
    readonly speed: string;
    /** What is left in an asteroid picked out alone, or null. */
    readonly asteroid: string | null;
}

export const NO_ORDERS: OrderState = {
    side: null,
    picked: [],
    armed: null,
    queue: null,
    designs: [],
    crewed: false,
    speed: "doctrine",
    asteroid: null,
};

/** An order as the queue lists it: what, against whom, and how far off and how fast where told. */
export function describe(order: OrderView, shown: Snapshot): string {
    // Making for somewhere doctrine has not chosen yet.
    let named =
        order.kind === "flee"
            ? "every enemy"
            : order.kind === "dock" || order.kind === "scavenge" || order.kind === "deliver"
              ? "nearest"
              : "gone";
    for (let i = 0; i < shown.shipCount; i++) {
        const target = shown.ships[i]!;
        if (target.body === order.target)
            named = target.rock === undefined ? `${teamName(target.team)} ${target.name ?? target.serial}` : "asteroid";
    }
    const distance = order.distance === undefined ? "" : ` · ${order.distance} m`;
    const speed = order.speed === undefined ? "" : ` · ${order.speed} m/s`;
    return `${order.kind} ${named}${distance}${speed}`;
}

/** A mass in tonnes, to three figures or so. */
function tonnes(kg: number): string {
    const t = kg / 1000;
    return `${t >= 100 ? Math.round(t).toLocaleString("en-GB") : t.toPrecision(3)} t`;
}

export function orderState(view: BattleView, shown: Snapshot): OrderState {
    const picked = [...view.picked];
    const ships = picked.map((i) => viewOf(shown, i)).filter((ship) => ship !== null);
    const one = picked.length === 1 ? ships[0] : undefined;
    const speeds = ships.map((ship) => ship.doctrine?.approach.approachSpeed);
    return {
        side: view.orderSide(shown),
        picked,
        armed: view.armed,
        queue: one?.ship === undefined ? null : { ship: one.ship, orders: (one.orders ?? []).map((order) => describe(order, shown)) },
        designs: ships.map((ship) => (ship.blueprint ?? ship.currentStructure).name),
        crewed: ships.length > 0 && ships.every((ship) => (ship.crews ?? []).some((n) => n > 0)),
        speed: speeds.length > 0 && speeds.every((v) => v !== undefined && v === speeds[0]) ? String(speeds[0]) : "doctrine",
        asteroid:
            one?.rock === undefined ? null : `rock ${tonnes(one.rock.rock)} · ore ${tonnes(one.rock.ore)} · ice ${tonnes(one.rock.ice)}`,
    };
}

/** The order state, read `SAMPLE_HZ` times a second, a new object only when it has changed. */
export function useOrderState(view: BattleView | null, shown: () => Snapshot | null): OrderState {
    const text = useSampled(() => {
        const at = shown();
        return view === null || at === null ? "" : JSON.stringify(orderState(view, at));
    });
    return useMemo(() => (text === "" ? NO_ORDERS : (JSON.parse(text) as OrderState)), [text]);
}
