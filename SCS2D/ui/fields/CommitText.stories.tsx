import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent } from "storybook/test";
import { CommitText } from "./CommitText";

/** Holds what was committed, and counts the commits, as an undo history would. */
function Named({ multiline }: { readonly multiline: boolean }) {
    const [name, setName] = useState("Line of Battle");
    const [commits, setCommits] = useState(0);
    return (
        <div>
            <CommitText
                aria-label="Name"
                title="The name"
                multiline={multiline}
                value={name}
                onCommit={(typed) => {
                    setName(typed);
                    setCommits((n) => n + 1);
                }}
            />
            <p>{`${commits} commits: ${name}`}</p>
        </div>
    );
}

const meta = {
    component: Named,
    tags: ["autodocs"],
} satisfies Meta<typeof Named>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OneLine: Story = {
    args: { multiline: false },
    play: async ({ canvas }) => {
        const box = canvas.getByRole("textbox", { name: "Name" });
        await userEvent.clear(box);
        await userEvent.type(box, "Escort");
        await expect(canvas.getByText("0 commits: Line of Battle")).toBeInTheDocument();
        await userEvent.keyboard("{Enter}");
        await expect(canvas.getByText("1 commits: Escort")).toBeInTheDocument();
        // Leaving it unchanged commits nothing more.
        await userEvent.tab();
        await expect(canvas.getByText("1 commits: Escort")).toBeInTheDocument();
    },
};

export const SeveralLines: Story = {
    args: { multiline: true },
    play: async ({ canvas }) => {
        const box = canvas.getByRole("textbox");
        await userEvent.clear(box);
        await userEvent.type(box, "One{Enter}Two");
        await expect(canvas.getByText("0 commits: Line of Battle")).toBeInTheDocument();
        await userEvent.tab();
        await expect(box).toHaveValue("One\nTwo");
        await expect(canvas.getByText(/1 commits: One/)).toBeInTheDocument();
    },
};
