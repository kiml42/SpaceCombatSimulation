import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, test } from "vitest";
import { LiveNumber, LiveText } from "./LiveText";
import { NumberField } from "./NumberField";

function Held({ min, max }: { readonly min: number; readonly max: number }) {
    const [value, setValue] = useState(5);
    return <LiveNumber aria-label="box" value={value} onEdit={setValue} step={1} min={min} max={max} />;
}

test("a number typed past its range is brought to the end it passed when the box is left", () => {
    render(<Held min={0} max={10} />);
    const box = screen.getByLabelText("box");
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "25" } });
    fireEvent.blur(box);
    expect(box).toHaveValue(10);
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "-3" } });
    fireEvent.blur(box);
    expect(box).toHaveValue(0);
});

test("Enter clamps as leaving does", () => {
    const typed: string[] = [];
    render(<LiveText aria-label="box" type="number" min={0} value="" onType={(text) => typed.push(text)} />);
    const box = screen.getByLabelText("box");
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "-4" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(typed.at(-1)).toBe("0");
});

test("a settings box clamps when left, and leaves a number in range alone", () => {
    const changes: string[] = [];
    const { rerender } = render(<NumberField label="n" title="n" value="12" step={1} max={10} onChange={(v) => changes.push(v)} />);
    fireEvent.blur(screen.getByLabelText("n"));
    expect(changes).toEqual(["10"]);
    rerender(<NumberField label="n" title="n" value="7" step={1} max={10} onChange={(v) => changes.push(v)} />);
    fireEvent.blur(screen.getByLabelText("n"));
    expect(changes).toEqual(["10"]);
});
