import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { KeyTable } from "./KeyTable";

const meta = {
    component: KeyTable,
    tags: ["autodocs"],
    args: {
        rows: [
            { keys: "Space", does: "Pause, or play" },
            { keys: "F", does: "Frame everything again" },
        ],
        notes: ["The ring marks where the gravity well pulls at 1 m/s²."],
    },
} satisfies Meta<typeof KeyTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
    play: async ({ canvas }) => {
        await expect(canvas.getByRole("row", { name: /Space/ })).toHaveTextContent("Pause, or play");
        await expect(canvas.getByText(/gravity well/)).toBeVisible();
    },
};
