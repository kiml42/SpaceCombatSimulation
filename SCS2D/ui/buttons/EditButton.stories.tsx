import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent } from "storybook/test";
import { EditButton, EditLink } from "./EditButton";

const meta = {
    component: EditButton,
    tags: ["autodocs"],
    args: { onClick: fn(), label: "Edit Corvette" },
} satisfies Meta<typeof EditButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Button: Story = {
    play: async ({ args, canvas }) => {
        await userEvent.click(canvas.getByRole("button", { name: "Edit Corvette" }));
        await expect(args.onClick).toHaveBeenCalledOnce();
    },
};

export const Link: Story = {
    render: () => <EditLink href="#/ship" label="Edit Gunship" />,
    play: async ({ canvas }) => {
        await expect(canvas.getByRole("link", { name: "Edit Gunship" })).toHaveAttribute("href", "#/ship");
    },
};
