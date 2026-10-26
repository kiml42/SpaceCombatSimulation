import { padHolds, placementOf, slipwayHolds, type DoctrinePart, type ShipView, type Snapshot } from "../sim/index.js";
import { keyOf, mountsOf, shared, slotsOf, told, valuesOf } from "../editor/doctrineParts.js";
import { MOUNT_SECTIONS, SHIP_SECTIONS, type DoctrineEntry } from "../editor/doctrine.js";
import { choices, type Choice } from "./designChoices.js";
import { mountAt, viewOf } from "../render/picking.js";
import type { BattleView } from "./battleView.js";
import { el } from "./dom.js";

/**
 * The doctrine of the picked ships, beside the order bar: the ship's, its
 * main and its secondary weapons', one placement's mounts, picked by clicking
 * one, and what its pads and slipways keep. Each box shows what the ships go
 * by, blank where they differ; an edit is a logged command for all of them,
 * over their blueprints, and clearing a box takes it back to theirs.
 */

function heading(level: "h3" | "h4", text: string): HTMLElement {
    const out = document.createElement(level);
    out.textContent = text;
    return out;
}
const PART_KEY = "p";

export function doctrinePanel(view: BattleView): { update(shown: Snapshot): void } {
    const panel = el<HTMLElement>("doctrinePanel");
    const toggle = el<HTMLButtonElement>("doctrine");
    let open = false;
    let part: DoctrinePart = "ship";
    let shownKey = "";
    /** Rebuild at the next frame whatever has focus: after an edit, so it shows what it now holds. */
    let force = false;
    let last: Snapshot | null = null;

    const setOpen = (next: boolean): void => {
        open = next;
        toggle.classList.toggle("armed", open);
        if (!open) {
            part = "ship";
            view.mark(null);
        }
        shownKey = "";
        force = true;
    };
    toggle.addEventListener("click", () => setOpen(!open));
    window.addEventListener("keydown", (event) => {
        const focus = document.activeElement;
        if (focus instanceof HTMLInputElement || focus instanceof HTMLTextAreaElement || event.ctrlKey || event.metaKey || event.altKey)
            return;
        if (event.key.toLowerCase() === PART_KEY && view.picked.length > 0) setOpen(!open);
    });

    // With the panel open on one ship, a click on one of its mounts tells that placement.
    view.pickPart((ship, x, y) => {
        if (!open || view.picked.length !== 1 || ship.ship !== view.picked[0]) return false;
        const module = mountAt(ship, x, y);
        if (module < 0) return false;
        const placement = placementOf(keyOf(ship.currentStructure, module));
        if (placement === undefined) return false;
        part = `placement:${placement}`;
        shownKey = "";
        force = true;
        return true;
    });

    const issue = (field: string, value: number | null): void => {
        view.issue({ kind: "doctrine", ships: view.picked, part, field, value });
        shownKey = "";
        force = true;
    };

    /** The boxes, under the editor's headings; a heading with nothing under it is left out. */
    const rows = (ships: readonly ShipView[]): HTMLElement[] => {
        const out: HTMLElement[] = [];
        for (const section of part === "ship" ? SHIP_SECTIONS : MOUNT_SECTIONS) {
            const under: HTMLElement[] = [];
            for (const group of section.groups) {
                const boxes = group.entries.flatMap((row) => box(ships, row) ?? []);
                // A section of one group says it once.
                if (boxes.length > 0 && group.title !== section.title) under.push(heading("h4", group.title));
                under.push(...boxes);
            }
            if (under.length > 0) out.push(heading("h3", section.title), ...under);
        }
        return out;
    };

    const box = (ships: readonly ShipView[], row: DoctrineEntry): HTMLElement | null => {
        const values = ships.flatMap((ship) => valuesOf(ship, part, row));
        const value = shared(values);
        if (value === null) return null;
        const label = document.createElement("label");
        label.title = row.hint;
        const name = document.createElement("span");
        name.textContent = row.label;
        const input = document.createElement("input");
        input.type = "number";
        input.step = String(row.step);
        input.dataset["field"] = row.field;
        input.value = value === undefined ? "" : String(value);
        input.placeholder = value === undefined ? "mixed" : "";
        const says = ships.some((ship) => told(ship.override, part, row));
        label.classList.toggle("told", says);
        input.addEventListener("change", () => {
            const typed = input.value.trim();
            issue(row.field, typed === "" ? null : Number(typed));
        });
        label.append(name);
        // Left of the box, so the box and its arrows stay put as it comes and goes.
        if (says) {
            const back = document.createElement("button");
            back.textContent = "↺";
            back.title = "Back to its design";
            back.addEventListener("click", () => issue(row.field, null));
            label.append(back);
        }
        label.append(input);
        return label;
    };

    const slots = (ships: readonly ShipView[], library: readonly Choice[]): HTMLElement[] =>
        slotsOf(ships).map((slot) => {
            const label = document.createElement("label");
            label.title = "What it builds, and how many of them it keeps in the fight";
            const name = document.createElement("span");
            name.textContent = slot.label;
            // What it builds: as designed, or anything in the library it could build.
            const craft = document.createElement("select");
            const designed = document.createElement("option");
            designed.value = "";
            designed.textContent = slot.craft ?? "mixed";
            craft.append(designed);
            const buildable = library.filter((choice) =>
                slot.pad
                    ? choice.design.fighter && padHolds(choice.design, slot.spec)
                    : !choice.design.fighter && slipwayHolds(choice.design, slot.spec),
            );
            buildable.forEach((choice, n) => {
                const option = document.createElement("option");
                option.value = String(n);
                option.textContent = choice.label;
                craft.append(option);
            });
            craft.addEventListener("change", () => {
                const choice = buildable[Number(craft.value)];
                if (craft.value === "" || choice === undefined) return;
                view.issue({ kind: "craft", ships: view.picked, slot: slot.key, blueprint: choice.blueprint });
                shownKey = "";
                force = true;
            });
            const input = document.createElement("input");
            input.type = "number";
            input.min = "0";
            input.step = "1";
            input.value = slot.keep === undefined ? "" : String(slot.keep);
            input.placeholder = slot.keep === undefined ? "mixed" : "";
            input.addEventListener("change", () => {
                const typed = input.value.trim();
                view.issue({
                    kind: "keep",
                    ships: view.picked,
                    slot: slot.key,
                    keep: typed === "" ? null : Math.max(0, Math.floor(Number(typed))),
                });
                shownKey = "";
                force = true;
            });
            label.append(name);
            // Left of the boxes, so they stay put as it comes and goes.
            if (ships.some((ship) => ship.crafts?.[slot.key] !== undefined)) {
                const back = document.createElement("button");
                back.textContent = "↺";
                back.title = "Back to what its design builds";
                back.addEventListener("click", () => {
                    view.issue({ kind: "craft", ships: view.picked, slot: slot.key, blueprint: null });
                    shownKey = "";
                    force = true;
                });
                label.append(back);
            }
            label.append(craft, input);
            return label;
        });

    const render = (ships: readonly ShipView[]): void => {
        const tabs = document.createElement("div");
        tabs.className = "tabs";
        const parts: [DoctrinePart, string][] = [
            ["ship", "Ship"],
            ["main", "Main weapons"],
            ["secondary", "Secondary weapons"],
        ];
        if (part.startsWith("placement:")) parts.push([part, "This mount"]);
        for (const [p, name] of parts) {
            const tab = document.createElement("button");
            tab.textContent = name;
            tab.classList.toggle("armed", p === part);
            tab.addEventListener("click", () => {
                part = p;
                shownKey = "";
                force = true;
                if (last !== null) update(last);
            });
            tabs.append(tab);
        }
        const body = document.createElement("div");
        body.className = "rows";
        body.append(...rows(ships));
        if (part === "ship") {
            const library = choices();
            const built = slots(ships, library);
            if (built.length > 0) body.append(heading("h3", "Building"), ...built);
        }
        if (body.childElementCount === 0) body.textContent = part === "ship" ? "" : "No such weapons";
        const reset = document.createElement("button");
        reset.textContent = "↺ Revert all";
        reset.title = "Take all of this back to what the blueprint says";
        reset.addEventListener("click", () => {
            view.issue({ kind: "resetDoctrine", ships: view.picked, part });
            shownKey = "";
            force = true;
        });
        const hint = document.createElement("p");
        hint.textContent = view.picked.length === 1 ? "Click a mount to tell it, and every copy of it, alone." : "";
        panel.replaceChildren(tabs, body, reset, hint);
    };

    const update = (shown: Snapshot): void => {
        last = shown;
        const side = view.orderSide(shown);
        toggle.hidden = side === null;
        panel.hidden = !open || side === null;
        if (panel.hidden) {
            view.mark(null);
            return;
        }
        const ships = view.picked.map((i) => viewOf(shown, i)).filter((s): s is ShipView => s !== null);
        // The mounts it is telling, on the one ship they were picked on.
        const one = ships.length === 1 ? ships[0]! : null;
        if (part.startsWith("placement:") && one !== null) {
            const modules = mountsOf(one.currentStructure, part).map((t) => one.currentStructure.turrets[t]!.module);
            view.mark({ ship: one.ship!, modules });
        } else {
            if (part.startsWith("placement:")) part = "ship";
            view.mark(null);
        }
        // Rebuilt only when what it shows changes, and never under a box being typed in.
        const key = JSON.stringify([
            view.picked,
            part,
            ships.map((s) => [
                s.override ?? null,
                s.keeps ?? null,
                Object.entries(s.crafts ?? {}).map(([slot, craft]) => [slot, craft.name]),
                s.currentStructure.turrets.length,
                s.blueprint?.name ?? "",
            ]),
        ]);
        // Never rebuilt under a box being typed in, unless that box has just been told.
        const focus = document.activeElement;
        const typing = panel.contains(focus) && (focus instanceof HTMLInputElement || focus instanceof HTMLSelectElement);
        if (key === shownKey || (typing && !force)) return;
        const fields = [...panel.querySelectorAll("input, select")];
        const at = typing ? fields.indexOf(focus) : -1;
        shownKey = key;
        force = false;
        render(ships);
        // Back where it was, so a Tab after an edit goes on to the next box.
        if (at >= 0) (panel.querySelectorAll("input, select")[at] as HTMLElement | undefined)?.focus();
    };
    return { update };
}
