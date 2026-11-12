import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { MainMenu, MORE, SANDBOX } from "./Home";

test("offers a skirmish to start when none is kept", () => {
    render(<MainMenu current={null} onNewSkirmish={() => {}} />);
    expect(screen.getByRole("link", { name: /^Start a skirmish/ })).toHaveAttribute("href", "#/skirmish");
    expect(screen.queryByRole("button", { name: "New skirmish" })).toBeNull();
});

test("offers to continue the skirmish kept, by name, with a new one beneath", () => {
    const onNew = vi.fn();
    render(<MainMenu current={{ title: "Iron Tide", status: "Round 4 · against Gunship" }} onNewSkirmish={onNew} />);
    expect(screen.getByRole("link", { name: /^Continue: Iron Tide/ })).toHaveTextContent("Round 4 · against Gunship");
    fireEvent.click(screen.getByRole("button", { name: "New skirmish" }));
    expect(onNew).toHaveBeenCalledOnce();
});

test("links the sandbox and the rest", () => {
    render(<MainMenu current={null} onNewSkirmish={() => {}} />);
    const sandbox = screen.getByRole("region", { name: "Sandbox" });
    for (const page of SANDBOX) expect(sandbox.querySelector(`a[href="${page.href}"]`)).not.toBeNull();
    const more = screen.getByRole("navigation", { name: "More" });
    for (const page of MORE) expect(more.querySelector(`a[href="${page.href}"]`)).not.toBeNull();
});

test("draws a backdrop behind, hidden from assistive tech", () => {
    render(<MainMenu current={null} onNewSkirmish={() => {}} backdrop={<canvas data-testid="demo" />} />);
    expect(screen.getByTestId("demo").parentElement).toHaveAttribute("aria-hidden", "true");
});
