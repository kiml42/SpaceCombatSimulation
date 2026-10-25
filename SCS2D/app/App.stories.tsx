import type { Meta, StoryObj } from "@storybook/react-vite";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, userEvent } from "storybook/test";
import { ObservedStorage, memoryStore } from "~/features/storage/observedStorage";
import { StorageProvider } from "~/features/storage/StorageProvider";
import { BLUEPRINTS } from "~/scenarios/blueprints";
import { serialiseBlueprint } from "~/sim/index";
import { ROUTES } from "./routes";

/** The whole app at one path, with storage of its own. */
function App({ path, saved = {} }: { readonly path: string; readonly saved?: Record<string, string> }) {
    const router = createMemoryRouter(ROUTES, { initialEntries: [path] });
    return (
        <StorageProvider storage={new ObservedStorage(memoryStore(saved))}>
            <RouterProvider router={router} />
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
        await userEvent.click(canvas.getByRole("link", { name: "Library" }));
        await expect(await canvas.findByRole("heading", { name: "Ships" })).toBeVisible();
        await expect(canvas.getByRole("link", { name: "Library" })).toHaveClass("active");
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

export const NotFound: Story = {
    args: { path: "/nowhere" },
    play: async ({ canvas }) => {
        await expect(canvas.getByText("There is no page here.")).toBeVisible();
    },
};
