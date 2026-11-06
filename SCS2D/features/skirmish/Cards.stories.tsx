import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent } from "storybook/test";
import { CardHand, CardPick } from "./Cards";

/** A hand to pick from, and the cards taken, as the fleet editor shows them. */
function Picking() {
    const [hand, setHand] = useState<readonly string[] | null>(["fuel", "metal-for-build", "spread-for-ship"]);
    const [held, setHeld] = useState<readonly string[]>(["metal", "ship", "metal", "metal"]);
    return (
        <div style={{ width: "34rem" }}>
            {hand !== null && (
                <CardPick
                    hand={hand}
                    onPick={(id) => {
                        setHeld([...held, id]);
                        setHand(null);
                    }}
                />
            )}
            <CardHand id="held" ids={held} empty="No upgrade cards yet." />
        </div>
    );
}

const meta = {
    component: Picking,
    tags: ["autodocs"],
} satisfies Meta<typeof Picking>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PickOne: Story = {
    play: async ({ canvas, canvasElement }) => {
        // Copies of one card are one pile, counted.
        await expect(canvas.getByLabelText("4 upgrade cards")).toBeInTheDocument();
        await expect(canvas.getByText("×3")).toBeInTheDocument();
        await userEvent.click(canvas.getByTitle("Take Deep Tanks"));
        await expect(canvas.queryByRole("group", { name: "Pick an upgrade card" })).not.toBeInTheDocument();
        await expect(canvas.getByLabelText("5 upgrade cards")).toBeInTheDocument();
        // The same face, held small.
        await expect(canvasElement.querySelectorAll('#held [data-card="fuel"]').length).toBe(1);
    },
};

export const NoneHeld: Story = {
    render: () => <CardHand ids={[]} empty="The enemy holds no upgrade cards yet." />,
    play: async ({ canvas }) => {
        await expect(canvas.getByText("The enemy holds no upgrade cards yet.")).toBeInTheDocument();
    },
};
