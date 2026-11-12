import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent } from "storybook/test";
import { PresetPicker } from "./PresetPicker";

/** Records what was picked, as the panels apply it. */
function Picking() {
    const [picked, setPicked] = useState("nothing");
    return (
        <div>
            <PresetPicker onPick={(preset) => setPicked(preset.name)} />
            <p>{`Picked ${picked}`}</p>
        </div>
    );
}

const meta = {
    component: Picking,
    tags: ["autodocs"],
} satisfies Meta<typeof Picking>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
    play: async ({ canvas }) => {
        const list = canvas.getByRole("combobox", { name: "Doctrine preset" });
        await userEvent.selectOptions(list, "Sniper");
        await expect(canvas.getByText("Picked Sniper")).toBeInTheDocument();
        // An action, not a setting: the list goes back to its prompt.
        await expect(list).toHaveValue("");
    },
};
