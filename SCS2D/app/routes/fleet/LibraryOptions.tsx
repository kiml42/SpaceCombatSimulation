import { byCategory, type LibraryEntry } from "~/editor/library";
import { optionLabel, optionValue } from "./fleetOptions";

/** A library's entries as a select's options, grouped by category; flat where none has one, as fleets do not. */
export function LibraryOptions({ entries }: { readonly entries: readonly LibraryEntry[] }) {
    const option = (entry: LibraryEntry) => (
        <option key={optionValue(entry)} value={optionValue(entry)}>
            {optionLabel(entry)}
        </option>
    );
    if (entries.every((entry) => entry.category === undefined)) return <>{entries.map(option)}</>;
    return (
        <>
            {byCategory(entries, (entry) => entry.category).map(([category, group]) => (
                <optgroup key={category} label={category}>
                    {group.map(option)}
                </optgroup>
            ))}
        </>
    );
}
