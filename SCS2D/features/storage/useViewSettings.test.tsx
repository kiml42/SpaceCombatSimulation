import { act, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import type { ViewSettings } from "~/host/viewSettings";
import { ObservedStorage, memoryStore } from "./observedStorage";
import { StorageProvider } from "./StorageProvider";
import { useViewSettings } from "./useViewSettings";

const DEFAULTS: ViewSettings = { arcs: "none", teamShots: false, strips: true, speed: 1 };

function Speed() {
    const [settings, update] = useViewSettings("viewer", DEFAULTS);
    return (
        <>
            <p>speed {settings.speed}</p>
            <button onClick={() => update({ speed: 8 })}>Faster</button>
        </>
    );
}

function renderWith(entries: Record<string, string>) {
    const store = memoryStore(entries);
    render(
        <StorageProvider storage={new ObservedStorage(store)}>
            <Speed />
        </StorageProvider>,
    );
    return store;
}

test("reads what the old page of the same name kept", () => {
    renderWith({ "scs2d.view.viewer": JSON.stringify({ ...DEFAULTS, speed: 4 }) });
    expect(screen.getByText("speed 4")).toBeVisible();
});

test("falls back to the defaults on what it cannot read", () => {
    renderWith({ "scs2d.view.viewer": "null" });
    expect(screen.getByText("speed 1")).toBeVisible();
});

test("keeps a change, and shows it", () => {
    const store = renderWith({});
    act(() => screen.getByRole("button", { name: "Faster" }).click());
    expect(screen.getByText("speed 8")).toBeVisible();
    expect(JSON.parse(store.getItem("scs2d.view.viewer")!)).toEqual({ ...DEFAULTS, speed: 8 });
});
