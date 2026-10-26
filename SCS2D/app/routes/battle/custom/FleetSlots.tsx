import { styled } from "@linaria/react";
import { useRef } from "react";
import { shipFleet } from "~/editor/handoff";
import { useLibrary } from "~/features/storage/useLibrary";
import { teamColour } from "~/render/teams";
import { fleetWarnings, parseBlueprint, parseFleet, type Fleet } from "~/sim/index";
import type { Slot } from "./customSetup";

const Row = styled.div`
    display: flex;
    gap: 0.4rem;
    align-items: center;
    margin-bottom: 0.3rem;

    select {
        flex: 1;
        min-width: 0;
    }
`;

const Swatch = styled.span`
    flex: none;
    width: 0.8rem;
    height: 0.8rem;
    border-radius: 2px;
`;

const valueOf = (source: Slot["source"]): string => (source.kind === "other" ? "other:" : `${source.kind}:${source.name}`);

const names = (entries: readonly { name: string }[]): string[] => [...new Set(entries.map((entry) => entry.name))];

export interface FleetSlotsProps {
    readonly slots: readonly Slot[];
    readonly onChange: (slots: Slot[]) => void;
    /** Something to tell the player: a file or a saved design that could not be read, or what in one is ignored. */
    readonly onProblem: (text: string) => void;
}

/** The sides of a custom battle, each a fleet or a single ship from the library or a file, in its side's colour. */
export function FleetSlots({ slots, onChange, onProblem }: FleetSlotsProps) {
    const { ships, fleets } = useLibrary();
    const files = useRef<HTMLInputElement>(null);

    const read = (kind: "fleet" | "ship", name: string): Fleet | null => {
        try {
            if (kind === "fleet") return fleets.load(name);
            const blueprint = ships.load(name);
            return blueprint === null ? null : shipFleet(blueprint);
        } catch (error) {
            onProblem(`Could not read the saved ${name}: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    };

    const choose = (index: number, value: string): void => {
        const [kind, ...rest] = value.split(":");
        const name = rest.join(":");
        if (kind !== "fleet" && kind !== "ship") return;
        const fleet = read(kind, name);
        if (fleet !== null) onChange(slots.map((slot, i) => (i === index ? { fleet, source: { kind, name } } : slot)));
    };

    // Another of whatever the last side was, as a start; its list changes it to any fleet or ship.
    const add = (): void => {
        const last = slots[slots.length - 1];
        if (last !== undefined) return onChange([...slots, last]);
        const name = fleets.list()[0]?.name;
        const fleet = name === undefined ? null : read("fleet", name);
        if (fleet !== null && name !== undefined) onChange([{ fleet, source: { kind: "fleet", name } }]);
    };

    // A fleet file or a blueprint file, told apart by what they carry; several at once.
    const fromFiles = async (list: readonly File[]): Promise<void> => {
        const added: Slot[] = [];
        const notes: string[] = [];
        for (const file of list) {
            try {
                const value: unknown = JSON.parse(await file.text());
                const isFleet = typeof value === "object" && value !== null && "designs" in value;
                const fleet = isFleet ? parseFleet(value) : shipFleet(parseBlueprint(value));
                added.push({ fleet, source: { kind: "other", label: `${fleet.name} (file)` } });
                // Read, and fought as read: a key nothing reads is said, not refused.
                const warnings = fleetWarnings(fleet);
                if (warnings.length > 0) notes.push(`${file.name} has keys the game does not read: ${warnings.join("; ")}`);
            } catch (error) {
                notes.push(`Could not read ${file.name}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        if (added.length > 0) onChange([...slots, ...added]);
        if (notes.length > 0) onProblem(notes.join("\n"));
    };

    const fleetNames = names(fleets.list());
    const shipNames = names(ships.list());
    return (
        <section aria-label="Fleets">
            {slots.map((slot, i) => (
                <Row key={i}>
                    <Swatch style={{ background: teamColour(i) }} />
                    <select aria-label={`Side ${i + 1}`} value={valueOf(slot.source)} onChange={(event) => choose(i, event.target.value)}>
                        {slot.source.kind === "other" && <option value="other:">{slot.source.label}</option>}
                        <optgroup label="Fleets">
                            {fleetNames.map((name) => (
                                <option key={name} value={`fleet:${name}`}>
                                    {name}
                                </option>
                            ))}
                        </optgroup>
                        <optgroup label="Single ships">
                            {shipNames.map((name) => (
                                <option key={name} value={`ship:${name}`}>
                                    {name}
                                </option>
                            ))}
                        </optgroup>
                    </select>
                    <button
                        aria-label={`Take side ${i + 1} out`}
                        title="Take this side out"
                        onClick={() => onChange(slots.filter((_, k) => k !== i))}
                    >
                        ×
                    </button>
                </Row>
            ))}
            <button title="Another side: a fleet or a single ship, chosen from its list" onClick={add}>
                Add fleet
            </button>{" "}
            <button title="Another side from a fleet file, or a ship from a blueprint file" onClick={() => files.current?.click()}>
                From file…
            </button>
            <input
                ref={files}
                type="file"
                accept="application/json,.json"
                multiple
                hidden
                onChange={(event) => {
                    void fromFiles([...(event.target.files ?? [])]);
                    event.target.value = "";
                }}
            />
        </section>
    );
}
