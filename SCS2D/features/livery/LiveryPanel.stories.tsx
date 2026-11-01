import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fireEvent, userEvent } from "storybook/test";
import type { Livery } from "~/sim/index";
import { LiveryPanel } from "./LiveryPanel";

/** Holds the livery and counts undo steps, as an editor's history would: a drag is one. */
function Painted() {
    const [livery, setLivery] = useState<Livery | undefined>(undefined);
    const [open, setOpen] = useState(true);
    const [steps, setSteps] = useState(0);
    const [dragging, setDragging] = useState(false);
    return (
        <div style={{ width: "20rem" }}>
            <LiveryPanel
                livery={livery}
                whose="the fleet's"
                note="Worn by every ship in the fleet."
                open={open}
                onOpen={setOpen}
                onChange={(next, continues) => {
                    setLivery(next);
                    if (!(continues && dragging)) setSteps((n) => n + 1);
                    setDragging(continues);
                }}
                onEnd={() => setDragging(false)}
            />
            <p>{`${steps} steps: ${livery === undefined ? "none" : `${livery.base} ${livery.pattern} ${livery.size}`}`}</p>
        </div>
    );
}

const meta = {
    component: Painted,
    tags: ["autodocs"],
} satisfies Meta<typeof Painted>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SetAndCleared: Story = {
    play: async ({ canvas }) => {
        await expect(canvas.getByText("side colours")).toBeInTheDocument();
        await userEvent.click(canvas.getByRole("button", { name: "Set a livery" }));
        await expect(canvas.getByText("1 steps: #5b8dd6 none 0.1")).toBeInTheDocument();

        await userEvent.selectOptions(canvas.getByRole("combobox", { name: "pattern" }), "stripes");
        await expect(canvas.getByRole("slider", { name: "angle" })).toBeInTheDocument();
        // A slider dragged through two values is one step.
        const size = canvas.getByRole("slider", { name: "size" });
        fireEvent.change(size, { target: { value: "0.2" } });
        fireEvent.change(size, { target: { value: "0.3" } });
        fireEvent.pointerUp(size);
        await expect(canvas.getByText("3 steps: #5b8dd6 stripes 0.3")).toBeInTheDocument();

        await userEvent.selectOptions(canvas.getByRole("combobox", { name: "pattern" }), "spots");
        await expect(canvas.queryByRole("slider", { name: "angle" })).toBeNull();

        await userEvent.click(canvas.getByRole("button", { name: "Side colours" }));
        await expect(canvas.getByText("5 steps: none")).toBeInTheDocument();
    },
};
