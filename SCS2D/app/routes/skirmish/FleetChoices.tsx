import type { Library } from "~/editor/library";
import type { Blueprint, Fleet } from "~/sim/index";

/** The list value of an empty fleet, to build from nothing. */
export const EMPTY = "empty:";

export interface FleetChoicesProps {
    readonly id: string;
    readonly label: string;
    readonly ships: Library<Blueprint>;
    readonly fleets: Library<Fleet>;
    /** `fleet:` or `ship:` and a name, or `EMPTY`. */
    readonly value: string;
    readonly onChange: (value: string) => void;
    /** Whether an empty fleet may be chosen. */
    readonly empty?: boolean;
}

/** A fleet from the library, or a single ship as a fleet of one. */
export function FleetChoices({ id, label, ships, fleets, value, onChange, empty = false }: FleetChoicesProps) {
    const names = (library: Library<Blueprint> | Library<Fleet>): string[] => [...new Set(library.list().map((entry) => entry.name))];
    return (
        <select id={id} aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
            {empty && <option value={EMPTY}>An empty fleet, to build</option>}
            <optgroup label="Fleets">
                {names(fleets).map((name) => (
                    <option key={name} value={`fleet:${name}`}>
                        {name}
                    </option>
                ))}
            </optgroup>
            <optgroup label="Single ships">
                {names(ships).map((name) => (
                    <option key={name} value={`ship:${name}`}>
                        {name}
                    </option>
                ))}
            </optgroup>
        </select>
    );
}
