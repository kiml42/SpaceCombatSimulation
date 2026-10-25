import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { Home, OLD_PAGES } from "./Home";

const meta = {
    component: Home,
    tags: ["autodocs"],
} satisfies Meta<typeof Home>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
    play: async ({ canvas }) => {
        const links = canvas.getAllByRole("link");
        await expect(links.map((link) => link.getAttribute("href"))).toEqual(OLD_PAGES.map((page) => page.href));
    },
};
