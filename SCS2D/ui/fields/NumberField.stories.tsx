import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent } from "storybook/test";
import { NumberField } from "./NumberField";

/** Holds its own value, as the page that uses it would. */
function Field({ withSpread }: { readonly withSpread: boolean }) {
    const [value, setValue] = useState("2000");
    const [spread, setSpread] = useState("0");
    return (
        <div style={{ width: "20rem" }}>
            <NumberField
                label="range m"
                title="Across the ring the fleets start on"
                value={value}
                onChange={setValue}
                step={100}
                {...(withSpread ? { spread: { value: spread, onChange: setSpread, title: "How far either side it may be drawn" } } : {})}
            />
        </div>
    );
}

const meta = {
    component: Field,
    tags: ["autodocs"],
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Plain: Story = {
    args: { withSpread: false },
    play: async ({ canvas }) => {
        const box = canvas.getByLabelText("range m");
        await userEvent.clear(box);
        await userEvent.type(box, "3500");
        await expect(box).toHaveValue(3500);
    },
};

export const WithSpread: Story = {
    args: { withSpread: true },
    play: async ({ canvas }) => {
        const spread = canvas.getByLabelText("range m either side");
        await userEvent.clear(spread);
        await userEvent.type(spread, "250");
        await expect(spread).toHaveValue(250);
        await expect(canvas.getByLabelText("range m")).toHaveValue(2000);
    },
};

/** A plain setting above one with a ±, as a settings card has them. */
function Card() {
    const [range, setRange] = useState("2000");
    const [spread, setSpread] = useState("0");
    const [seed, setSeed] = useState("1");
    return (
        <div style={{ width: "20rem" }}>
            <NumberField label="seed" title="Which battle" value={seed} onChange={setSeed} step={1} />
            <NumberField
                label="range m"
                title="How far apart"
                value={range}
                onChange={setRange}
                step={100}
                spread={{ value: spread, onChange: setSpread, title: "Either side" }}
            />
        </div>
    );
}

export const AlignedOnACard: StoryObj<typeof Card> = {
    render: () => <Card />,
    play: async ({ canvas }) => {
        const plain = canvas.getByLabelText("seed").getBoundingClientRect();
        const main = canvas.getByLabelText("range m").getBoundingClientRect();
        const spread = canvas.getByLabelText("range m either side").getBoundingClientRect();
        // A plain box spans what a box and its ± share, so both edges line up.
        await expect(plain.left).toBeCloseTo(main.left, 0);
        await expect(plain.right).toBeCloseTo(spread.right, 0);
    },
};
