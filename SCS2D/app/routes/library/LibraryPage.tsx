import { styled } from "@linaria/react";
import { useNavigate } from "react-router";
import { battleRoute, openFleetRoute, openShipRoute } from "~/editor/handoff";
import type { Library, LibraryEntry } from "~/editor/library";
import { useLibrary } from "~/features/storage/useLibrary";
import { shipFleet, type Blueprint, type Fleet } from "~/sim/index";
import { Button } from "~/ui/buttons/Button";
import { EditButton } from "~/ui/buttons/EditButton";
import { fromLibrary, optionValue } from "../fleet/fleetOptions";

const Main = styled.main`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(22rem, 1fr));
    gap: 1.5rem;
    max-width: 60rem;
    padding: 1.5rem;
`;

const Heading = styled.h2`
    margin: 0 0 0.6rem;
    color: var(--colour-heading);
    font-size: 1rem;
    font-weight: 600;
`;

const List = styled.ul`
    margin: 0;
    padding: 0;
    list-style: none;
`;

const Item = styled.li`
    display: flex;
    gap: 0.4rem;
    align-items: center;
    padding: 0.25rem 0;
    border-bottom: 1px solid var(--colour-border);

    > span:first-child {
        flex: 1;
    }
`;

const Kind = styled.span`
    margin-right: 0.4rem;
    color: var(--colour-muted);
`;

interface EntriesProps {
    readonly title: string;
    readonly entries: readonly LibraryEntry[];
    /** Where Edit goes for an entry. */
    readonly edit: (entry: string) => string;
    /** The fleet Test fights with, or null where it cannot be read. */
    readonly fleet: (entry: string) => Fleet | null;
}

function Entries({ title, entries, edit, fleet }: EntriesProps) {
    const navigate = useNavigate();
    return (
        <section aria-label={title}>
            <Heading>{title}</Heading>
            <List>
                {entries.map((entry) => {
                    const value = optionValue(entry);
                    // A stock ship shadowed by a saved one of its name is told apart, as the editors do.
                    const named = entry.name + (entry.stock && entry.saved ? " (stock)" : "");
                    return (
                        <Item key={`${entry.name}/${entry.stock ? "stock" : "saved"}`}>
                            <span>{entry.name}</span>
                            <Kind>{entry.stock ? "stock" : "saved"}</Kind>
                            <EditButton label={`Edit ${named}`} title="Open it in its editor" onClick={() => void navigate(edit(value))} />
                            <Button
                                aria-label={`Test ${named}`}
                                title="Fight it in a custom battle, as the first side"
                                onClick={() => {
                                    const opened = fleet(value);
                                    if (opened !== null) void navigate(battleRoute(opened));
                                }}
                            >
                                Test
                            </Button>
                        </Item>
                    );
                })}
            </List>
        </section>
    );
}

/** The ships and fleets every page can open, each to edit or to try in a battle. */
export function LibraryPage() {
    const { ships, fleets } = useLibrary();
    const shipAsFleet = (library: Library<Blueprint>) => (entry: string) => {
        const ship = fromLibrary(library, entry);
        return ship === null ? null : shipFleet(ship);
    };
    return (
        <Main>
            <Entries title="Ships" entries={ships.list()} edit={openShipRoute} fleet={shipAsFleet(ships)} />
            <Entries title="Fleets" entries={fleets.list()} edit={openFleetRoute} fleet={(entry) => fromLibrary(fleets, entry)} />
        </Main>
    );
}
