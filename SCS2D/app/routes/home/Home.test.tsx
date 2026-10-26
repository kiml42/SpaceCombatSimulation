import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Home } from "./Home";

test("lists the pages it is given", () => {
    render(<Home pages={[{ href: "#/ship", name: "Ship", purpose: "Draw a ship" }]} />);
    expect(screen.getByRole("link", { name: "Ship" })).toHaveAttribute("href", "#/ship");
    expect(screen.getByText("Draw a ship")).toBeVisible();
});
