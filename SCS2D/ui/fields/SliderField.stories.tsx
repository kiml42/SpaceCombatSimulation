import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fireEvent, userEvent } from "storybook/test";
import { SliderField } from "./SliderField";

/** Holds its value, and counts what was typed apart from what was dragged. */
function Held() {
    const [value, setValue] = useState(45);
    const [typed, setTyped] = useState(0);
    return (
        <div style={{ width: "22rem" }}>
            <SliderField
                id="bend"
                label="chevron"
                title="How far each arm turns from straight"
                value={value}
                min={0}
                max={75}
                step={1}
                unit="°"
                onChange={(next, continues) => {
                    setValue(next);
                    if (!continues) setTyped((n) => n + 1);
                }}
            />
            <p>{`${value} after ${typed} typed`}</p>
        </div>
    );
}

const meta = {
    component: Held,
    tags: ["autodocs"],
} satisfies Meta<typeof Held>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DraggedAndTyped: Story = {
    play: async ({ canvas }) => {
        const slider = canvas.getByRole("slider", { name: "chevron" });
        const box = canvas.getByRole("textbox", { name: "chevron, typed" });
        await expect(box).toHaveValue("45");

        // Dragged, the box follows.
        fireEvent.change(slider, { target: { value: "30" } });
        await expect(box).toHaveValue("30");
        await expect(canvas.getByText("30 after 0 typed")).toBeInTheDocument();

        // Typed, the slider follows on Enter, and not before.
        await userEvent.clear(box);
        await userEvent.type(box, "12");
        await expect(slider).toHaveValue("30");
        await userEvent.keyboard("{Enter}");
        await expect(slider).toHaveValue("12");
        await expect(canvas.getByText("12 after 1 typed")).toBeInTheDocument();

        // Held to the range, on leaving the box as on Enter.
        await userEvent.clear(box);
        await userEvent.type(box, "200");
        await userEvent.tab();
        await expect(box).toHaveValue("75");
        await expect(canvas.getByText("75 after 2 typed")).toBeInTheDocument();

        // Escape, or something that is not a number, puts back what it was.
        await userEvent.clear(box);
        await userEvent.type(box, "5{Escape}");
        await expect(box).toHaveValue("75");
        await userEvent.clear(box);
        await userEvent.type(box, "steep{Enter}");
        await expect(box).toHaveValue("75");
        await expect(canvas.getByText("75 after 2 typed")).toBeInTheDocument();
    },
};
