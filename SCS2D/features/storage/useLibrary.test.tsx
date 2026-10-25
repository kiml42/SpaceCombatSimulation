import { act, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { serialiseBlueprint } from "~/sim/index";
import { BLUEPRINTS } from "~/scenarios/blueprints";
import { ObservedStorage, memoryStore } from "./observedStorage";
import { StorageProvider } from "./StorageProvider";
import { useLibrary } from "./useLibrary";

const [stock] = Object.values(BLUEPRINTS);

function SavedShips() {
    const { ships } = useLibrary();
    return <p>{ships.savedNames().join(", ") || "none"}</p>;
}

test("re-renders when a ship is saved through the library", () => {
    const storage = new ObservedStorage(memoryStore());
    render(
        <StorageProvider storage={storage}>
            <SavedShips />
        </StorageProvider>,
    );
    expect(screen.getByText("none")).toBeVisible();

    act(() => {
        storage.setItem("scs2d.blueprint.Probe", JSON.stringify(serialiseBlueprint({ ...stock!, name: "Probe" })));
    });
    expect(screen.getByText("Probe")).toBeVisible();
});

test("re-renders when another tab saves", () => {
    const store = memoryStore();
    const storage = new ObservedStorage(store);
    render(
        <StorageProvider storage={storage}>
            <SavedShips />
        </StorageProvider>,
    );

    // Written past the wrapper, as another tab's write reaches the shared storage.
    store.setItem("scs2d.blueprint.Elsewhere", JSON.stringify(serialiseBlueprint({ ...stock!, name: "Elsewhere" })));
    expect(screen.getByText("none")).toBeVisible();
    act(() => storage.changed());
    expect(screen.getByText("Elsewhere")).toBeVisible();
});
