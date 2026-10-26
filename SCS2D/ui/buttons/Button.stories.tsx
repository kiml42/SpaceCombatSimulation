import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, userEvent } from "storybook/test";
import { Button, ToggleButton } from "./Button";

const meta = {
    component: Button,
    tags: ["autodocs"],
    args: { onClick: fn(), children: "Save" },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Plain: Story = {
    play: async ({ args, canvas }) => {
        await userEvent.click(canvas.getByRole("button", { name: "Save" }));
        await expect(args.onClick).toHaveBeenCalledOnce();
    },
};

export const Primary: Story = {
    args: { variant: "primary", children: "Fight" },
};

export const Icon: Story = {
    args: { variant: "icon", children: "✕", "aria-label": "Take back" },
};

export const Disabled: Story = {
    args: { disabled: true, children: "Delete" },
    play: async ({ args, canvas }) => {
        const button = canvas.getByRole("button", { name: "Delete" });
        await expect(button).toBeDisabled();
        await userEvent.click(button, { pointerEventsCheck: 0 });
        await expect(args.onClick).not.toHaveBeenCalled();
    },
};

/** Holds whether it is pressed, as the page using it would. */
function Pressable() {
    const [pressed, setPressed] = useState(false);
    return (
        <ToggleButton pressed={pressed} onPressedChange={setPressed}>
            Doctrine
        </ToggleButton>
    );
}

export const Toggle: StoryObj<typeof Pressable> = {
    render: () => <Pressable />,
    play: async ({ canvas }) => {
        const button = canvas.getByRole("button", { name: "Doctrine" });
        await expect(button).toHaveAttribute("aria-pressed", "false");
        await userEvent.click(button);
        await expect(button).toHaveAttribute("aria-pressed", "true");
        await userEvent.click(button);
        await expect(button).toHaveAttribute("aria-pressed", "false");
    },
};
