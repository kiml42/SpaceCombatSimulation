import { namesByCategory, type Library } from "~/editor/library";
import type { Blueprint, Fleet } from "~/sim/index";

/** The list value of an empty fleet, to build from nothing. */
export const EMPTY = "empty:";

export interface FleetChoicesProps {
    readonly id: string;
    readonly label: string;
    readonly ships: Library<Blueprint>;
    readonly fleets: Library<Fleet>;
    /** `fleet:` or `ship:` and a name. */
    readonly value: string;
    readonly onChange: (value: string) => void;
}

/** A fleet from the library, or a single ship as a fleet of one. */
export function FleetChoices({ id, label, ships, fleets, value, onChange }: FleetChoicesProps) {
    return (
        <select id={id} aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
            <optgroup label="Fleets">
                {[...new Set(fleets.list().map((entry) => entry.name))].map((name) => (
                    <option key={name} value={`fleet:${name}`}>
                        {name}
                    </option>
                ))}
            </optgroup>
            {namesByCategory(ships.list()).map(([category, names]) => (
                <optgroup key={category} label={`Single ships: ${category}`}>
                    {names.map((name) => (
                        <option key={name} value={`ship:${name}`}>
                            {name}
                        </option>
                    ))}
                </optgroup>
            ))}
        </select>
    );
}
