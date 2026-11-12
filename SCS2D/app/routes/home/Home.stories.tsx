import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent } from "storybook/test";
import { MainMenu } from "./Home";

const meta = {
    component: MainMenu,
    tags: ["autodocs"],
    parameters: { layout: "fullscreen" },
    args: { current: null, onNewSkirmish: fn() },
} satisfies Meta<typeof MainMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A first visit: nothing to continue. */
export const FirstVisit: Story = {
    play: async ({ canvas }) => {
        await expect(canvas.getByRole("link", { name: /^Start a skirmish/ })).toHaveAttribute("href", "#/skirmish");
        await expect(canvas.queryByRole("button", { name: "New skirmish" })).toBeNull();
    },
};

export const Continuing: Story = {
    args: { current: { title: "Iron Tide", status: "Round 4 · try 2 · against Line of Battle" } },
    play: async ({ canvas, args }) => {
        await expect(canvas.getByRole("link", { name: /^Continue: Iron Tide/ })).toBeVisible();
        await userEvent.click(canvas.getByRole("button", { name: "New skirmish" }));
        await expect(args.onNewSkirmish).toHaveBeenCalledOnce();
    },
};

export const ContinuingUnnamed: Story = {
    args: { current: { title: "Unnamed skirmish", status: "Round 2 won · the enemy is adapting" } },
};

/** Something drawn behind the menu, standing in for a demo battle. */
export const WithBackdrop: Story = {
    args: {
        ...Continuing.args,
        backdrop: (
            <div
                style={{
                    position: "absolute",
                    inset: 0,
                    background: "radial-gradient(circle at 70% 30%, #1d3557 0%, transparent 60%)",
                }}
            />
        ),
    },
};
