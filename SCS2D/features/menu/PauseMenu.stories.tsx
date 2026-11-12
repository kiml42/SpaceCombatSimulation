import type { Meta, StoryObj } from "@storybook/react-vite";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, fn, userEvent, within } from "storybook/test";
import { PauseMenu, type PauseMenuProps } from "./PauseMenu";

/** The menu on a page of its own, with a main menu to leave for. */
function OnPage(props: PauseMenuProps) {
    const router = createMemoryRouter(
        [
            { path: "/", element: <h1>Main menu</h1> },
            { path: "/page", element: <PauseMenu {...props} /> },
        ],
        { initialEntries: ["/page"] },
    );
    return <RouterProvider router={router} />;
}

const resume = fn();

const meta = {
    component: OnPage,
    args: {
        title: "Paused",
        pause: fn(() => resume),
        actions: [{ id: "restart", label: "Restart", onSelect: fn() }],
        keys: [{ keys: "Space", does: "Pause, or play" }],
    },
} satisfies Meta<typeof OnPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PausesAndResumes: Story = {
    play: async ({ canvas, args }) => {
        await userEvent.click(canvas.getByRole("button", { name: "Menu" }));
        const menu = canvas.getByRole("dialog", { name: "Paused" });
        await expect(args.pause).toHaveBeenCalledOnce();
        await userEvent.click(within(menu).getByRole("button", { name: "Restart" }));
        await expect(resume).toHaveBeenCalled();
        await expect(args.actions![0]!.onSelect).toHaveBeenCalledOnce();
        await expect(canvas.queryByRole("dialog")).toBeNull();
    },
};

export const EscapeOpensAndCloses: Story = {
    play: async ({ canvas }) => {
        await userEvent.keyboard("{Escape}");
        await expect(await canvas.findByRole("dialog", { name: "Paused" })).toBeVisible();
        await userEvent.keyboard("{Escape}");
        await expect(canvas.queryByRole("dialog")).toBeNull();
    },
};

export const Keys: Story = {
    play: async ({ canvas }) => {
        await userEvent.keyboard("?");
        const keys = await canvas.findByRole("dialog", { name: "Keys and mouse" });
        await expect(keys).toHaveTextContent("Pause, or play");
        await userEvent.click(within(keys).getByRole("button", { name: "Back" }));
        await expect(canvas.getByRole("dialog", { name: "Paused" })).toBeVisible();
    },
};

export const AsksBeforeLeavingUnsaved: Story = {
    args: { title: "Ship designer", pause: fn(() => resume), unsaved: { what: "Probe", save: fn() } },
    play: async ({ canvas, args }) => {
        await userEvent.click(canvas.getByRole("button", { name: "Menu" }));
        await userEvent.click(canvas.getByRole("button", { name: "Main menu" }));
        const asking = canvas.getByRole("dialog", { name: "Unsaved changes" });
        await expect(asking).toHaveTextContent("Probe has changes that are not saved.");
        await userEvent.click(within(asking).getByRole("button", { name: "Save and leave" }));
        await expect(args.unsaved!.save).toHaveBeenCalledOnce();
        await expect(await canvas.findByRole("heading", { name: "Main menu" })).toBeVisible();
    },
};
