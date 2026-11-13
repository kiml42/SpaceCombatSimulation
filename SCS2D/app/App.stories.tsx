import type { Meta, StoryObj } from "@storybook/react-vite";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { ObservedStorage, memoryStore } from "~/features/storage/observedStorage";
import { SkirmishProvider } from "~/features/skirmish/SkirmishProvider";
import { StorageProvider } from "~/features/storage/StorageProvider";
import { BLUEPRINTS, CORVETTE } from "~/scenarios/blueprints";
import { newSkirmish, serialiseSkirmish, SKIRMISH_STORAGE_KEY } from "~/scenarios/skirmish";
import { serialiseBlueprint, shipFleet } from "~/sim/index";
import { ROUTES } from "./routes";

/** The whole app at one path, with storage of its own. */
function App({ path, saved = {} }: { readonly path: string; readonly saved?: Record<string, string> }) {
    const router = createMemoryRouter(ROUTES, { initialEntries: [path] });
    return (
        <StorageProvider storage={new ObservedStorage(memoryStore(saved))}>
            <SkirmishProvider>
                <RouterProvider router={router} />
            </SkirmishProvider>
        </StorageProvider>
    );
}

const meta = {
    component: App,
    parameters: { layout: "fullscreen" },
} satisfies Meta<typeof App>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Start: Story = {
    args: { path: "/" },
    play: async ({ canvas }) => {
        // The menu is the way out, with no bar over it.
        await expect(canvas.queryByRole("navigation", { name: "Main" })).toBeNull();
        await expect(canvas.getByRole("link", { name: "Library" })).toHaveAttribute("href", "#/library");
    },
};

export const Menu: Story = {
    args: { path: "/effects" },
    play: async ({ canvas }) => {
        await userEvent.click(canvas.getByRole("button", { name: "Menu" }));
        const menu = await canvas.findByRole("dialog", { name: "Paused" });
        await userEvent.click(within(menu).getByRole("button", { name: "Main menu" }));
        await expect(await canvas.findByRole("heading", { name: "Space Combat Simulation" })).toBeVisible();
    },
};

const kept = newSkirmish(shipFleet(CORVETTE), shipFleet(CORVETTE), 1, undefined, undefined, "Iron Tide");

/** A skirmish kept: the menu offers it, and asks before giving it up for a new one. */
export const StartContinuing: Story = {
    args: { path: "/", saved: { [SKIRMISH_STORAGE_KEY]: JSON.stringify(serialiseSkirmish(kept)) } },
    play: async ({ canvas }) => {
        await expect(canvas.getByRole("link", { name: /^Continue: Iron Tide/ })).toHaveTextContent("Round 1");
        await userEvent.click(canvas.getByRole("button", { name: "New skirmish" }));
        const dialog = await canvas.findByRole("dialog", { name: "Start a new skirmish?" });
        await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
        await expect(canvas.getByRole("link", { name: /^Continue: Iron Tide/ })).toBeVisible();
        await userEvent.click(canvas.getByRole("button", { name: "New skirmish" }));
        await userEvent.click(within(await canvas.findByRole("dialog")).getByRole("button", { name: "Start new" }));
        await expect(await canvas.findByRole("heading", { name: "New skirmish" })).toBeVisible();
    },
};

const [stock] = Object.values(BLUEPRINTS);

export const Library: Story = {
    args: {
        path: "/library",
        saved: { "scs2d.blueprint.Probe": JSON.stringify(serialiseBlueprint({ ...stock!, name: "Probe" })) },
    },
    play: async ({ canvas }) => {
        const ships = canvas.getByRole("region", { name: "Ships" });
        await expect(ships).toHaveTextContent(`${stock!.name}stock`);
        await expect(ships).toHaveTextContent("Probesaved");
        await expect(canvas.getByRole("region", { name: "Fleets" })).toBeVisible();
    },
};

export const LibraryEdit: Story = {
    args: Library.args,
    play: async ({ canvas }) => {
        await userEvent.click(canvas.getByRole("button", { name: "Edit Probe" }));
        await expect(await canvas.findByRole("combobox", { name: "Ship" })).toHaveDisplayValue("Probe •");
    },
};

export const LibraryTest: Story = {
    args: Library.args,
    play: async ({ canvas, canvasElement }) => {
        await userEvent.click(canvas.getByRole("button", { name: "Test in Simulator: Probe" }));
        await waitFor(() => expect(canvasElement.querySelector("#fleetSlots option:checked")?.textContent).toMatch(/^Probe/));
    },
};

export const NotFound: Story = {
    args: { path: "/nowhere" },
    play: async ({ canvas }) => {
        await expect(canvas.getByText("There is no page here.")).toBeVisible();
    },
};

export const Battle: Story = {
    args: { path: "/simulator" },
    play: async ({ canvas }) => {
        const readout = canvas.getByLabelText("Battle time");
        await waitFor(() => expect(readout).toHaveTextContent(/step [1-9]/));
        await userEvent.click(canvas.getByRole("button", { name: "Pause" }));
        await expect(canvas.getByRole("button", { name: "Play" })).toBeVisible();
        await userEvent.selectOptions(canvas.getByRole("combobox", { name: "Scenario" }), "Swarm");
        await expect(canvas.getByRole("combobox", { name: "Scenario" })).toHaveDisplayValue("Swarm");
        await userEvent.selectOptions(canvas.getByRole("combobox", { name: "Variant" }), "300 fighters");
        await expect(canvas.getByRole("combobox", { name: "Variant" })).toHaveDisplayValue("300 fighters");
    },
};

export const CustomBattle: Story = {
    args: { path: "/simulator" },
    play: async ({ canvas }) => {
        await userEvent.click(canvas.getByRole("button", { name: "Custom" }));
        const panel = canvas.getByRole("complementary", { name: "Custom battle" });
        await expect(within(panel).getByRole("button", { name: "Fight" })).toBeDisabled();
        await userEvent.click(within(panel).getByRole("button", { name: "Add fleet" }));
        await expect(within(panel).getByRole("button", { name: "Fight" })).toBeEnabled();
        await expect(within(panel).getByRole("combobox", { name: "Side 1" })).toBeVisible();
    },
};

export const Fleet: Story = {
    args: { path: "/fleet" },
    play: async ({ canvas }) => {
        await expect(canvas.getByRole("combobox", { name: "Fleet" })).toHaveDisplayValue("Line of Battle");
        await expect(canvas.getByRole("row", { name: /^ships/ })).toHaveTextContent("ships5");
        await userEvent.click(canvas.getByRole("button", { name: "Add saved ship ▾" }));
        // The fleet's own copy first, then the library's.
        await userEvent.click(canvas.getAllByRole("menuitem", { name: "Corvette" })[0]!);
        await expect(canvas.getByRole("heading", { name: "Ship: Corvette" })).toBeVisible();
        await expect(canvas.getByRole("row", { name: /^ships/ })).toHaveTextContent("ships6");
        await userEvent.click(canvas.getByRole("button", { name: "Undo" }));
        await expect(canvas.getByRole("row", { name: /^ships/ })).toHaveTextContent("ships5");
    },
};

export const Ship: Story = {
    args: { path: "/ship" },
    play: async ({ canvas }) => {
        await expect(canvas.getByRole("combobox", { name: "Ship" })).toHaveDisplayValue("Corvette");
        await waitFor(() => expect(canvas.getByRole("row", { name: /^Burn/ })).toBeVisible());
        await userEvent.click(canvas.getByRole("button", { name: "Tank" }));
        await expect(canvas.getByRole("heading", { name: "Selected module" })).toBeVisible();
        await expect(canvas.getByRole("combobox", { name: "kind" })).toHaveDisplayValue("tank");
        await userEvent.click(canvas.getByRole("button", { name: "Undo" }));
        await expect(canvas.queryByRole("heading", { name: "Selected module" })).toBeNull();
        // With nothing selected, the selection's sidebar offers modules to add.
        await expect(canvas.getByText("Or select a module to change it.")).toBeVisible();
    },
};

/** The setup screen and the fleet editor, their help already seen. */
const SEEN_HELP = { "scs2d.help.skirmish": "seen", "scs2d.help.fleet": "seen" };

export const Skirmish: Story = {
    args: { path: "/skirmish", saved: SEEN_HELP },
    play: async ({ canvas }) => {
        await expect(canvas.getByRole("combobox", { name: "Enemy fleet" })).not.toBeVisible();
        await expect(canvas.getByRole("combobox", { name: "Enemy" })).toHaveDisplayValue(/./);
        await waitFor(() => expect(canvas.getByText(/^Next, build your fleet/)).toHaveTextContent("within a budget of"));
        // A fleet is built next, in the fleet editor.
        await userEvent.click(canvas.getByRole("button", { name: "Start: build your fleet" }));
        await expect(await canvas.findByRole("button", { name: "Add new ship" })).toBeVisible();
    },
};

/** The first time, how a skirmish works opens by itself; ? brings it back. */
export const SkirmishHelp: Story = {
    args: { path: "/skirmish" },
    play: async ({ canvas }) => {
        const help = await canvas.findByRole("dialog", { name: "How a skirmish works" });
        await expect(help).toHaveTextContent("every time you beat it, it evolves to counter your fleet");
        await userEvent.click(within(help).getByRole("button", { name: "Got it" }));
        await expect(canvas.queryByRole("dialog")).toBeNull();
        await userEvent.click(canvas.getByRole("button", { name: "How a skirmish works" }));
        await expect(canvas.getByRole("dialog", { name: "How a skirmish works" })).toBeVisible();
    },
};

/** The first fleet of a skirmish: how to build one opens by itself; ? beside the menu brings it back. */
export const FleetHelp: Story = {
    args: { path: "/skirmish", saved: { "scs2d.help.skirmish": "seen" } },
    play: async ({ canvas }) => {
        await userEvent.click(canvas.getByRole("button", { name: "Start: build your fleet" }));
        const help = await canvas.findByRole("dialog", { name: "Building your fleet" });
        await expect(help).toHaveTextContent("inside the dashed circle");
        await expect(help).toHaveTextContent("Stay within budget");
        await expect(help).toHaveTextContent("Click Add new ship, which takes you to the ship editor");
        await userEvent.click(within(help).getByRole("button", { name: "Got it" }));
        await expect(canvas.queryByRole("dialog")).toBeNull();
        await userEvent.click(canvas.getByRole("button", { name: "Building your fleet" }));
        await expect(canvas.getByRole("dialog", { name: "Building your fleet" })).toBeVisible();
    },
};

/** Setting a skirmish up, the menu button only goes back. */
export const SkirmishSetupBack: Story = {
    args: { path: "/skirmish", saved: SEEN_HELP },
    play: async ({ canvas }) => {
        await userEvent.click(canvas.getByRole("button", { name: "Menu" }));
        await expect(canvas.queryByRole("dialog")).toBeNull();
        await expect(await canvas.findByRole("heading", { name: "Space Combat Simulation" })).toBeVisible();
    },
};

export const Effects: Story = {
    args: { path: "/effects" },
    play: async ({ canvas }) => {
        await userEvent.selectOptions(canvas.getByRole("combobox", { name: "Effect" }), "Beams");
        await expect(canvas.getByText(/^Four hull beams/)).toBeVisible();
        await userEvent.click(canvas.getByRole("button", { name: "Pause" }));
        await expect(canvas.getByRole("button", { name: "Play" })).toBeVisible();
        await userEvent.keyboard(" ");
        await expect(canvas.getByRole("button", { name: "Pause" })).toBeVisible();
        await userEvent.keyboard(".");
        await expect(canvas.getByRole("button", { name: "Play" })).toBeVisible();
    },
};

export const Evolution: Story = {
    args: { path: "/evolution" },
    play: async ({ canvas }) => {
        await expect(canvas.getByRole("listbox", { name: /ships and fleets the run starts from/ })).toBeVisible();
        await userEvent.click(canvas.getByRole("button", { name: "Start" }));
        await expect(canvas.getByRole("button", { name: "Run" })).toHaveAttribute("aria-pressed", "true");
        await waitFor(() => expect(canvas.getByText("running")).toBeVisible());
        await userEvent.click(canvas.getByRole("button", { name: "Stop" }));
    },
};
