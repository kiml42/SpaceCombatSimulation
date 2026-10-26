import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent } from "storybook/test";
import { KeyHelp } from "./KeyHelp";

const meta = {
    component: KeyHelp,
    tags: ["autodocs"],
    args: {
        rows: [
            { keys: "Space", does: "Pause, or play" },
            { keys: "F", does: "Frame everything again" },
        ],
        notes: ["The ring marks where the gravity well pulls at 1 m/s²."],
    },
} satisfies Meta<typeof KeyHelp>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Opened: Story = {
    play: async ({ canvas }) => {
        await userEvent.click(canvas.getByRole("button", { name: "Keys" }));
        const dialog = canvas.getByRole("dialog", { name: "Keys and mouse" });
        await expect(dialog).toBeVisible();
        await expect(dialog).toHaveTextContent("Pause, or play");
        await userEvent.click(canvas.getByRole("button", { name: "Close" }));
        await expect(dialog).not.toBeVisible();
    },
};

export const OpenedByQuestionMark: Story = {
    play: async ({ canvas }) => {
        await userEvent.keyboard("?");
        await expect(canvas.getByRole("dialog", { name: "Keys and mouse" })).toBeVisible();
        await userEvent.keyboard("{Escape}");
    },
};
