import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Home } from "./Home";

test("lists the pages it is given", () => {
    render(<Home pages={[{ href: "editor.html", name: "Ship editor", purpose: "Draw a ship" }]} />);
    expect(screen.getByRole("link", { name: "Ship editor" })).toHaveAttribute("href", "editor.html");
    expect(screen.getByText("Draw a ship")).toBeVisible();
});
