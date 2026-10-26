import { styled } from "@linaria/react";
import type { LibraryEntry } from "~/editor/library";
import { useLibrary } from "~/features/storage/useLibrary";

const Main = styled.main`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
    gap: 1.5rem;
    max-width: 50rem;
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
    justify-content: space-between;
    gap: 1rem;
    padding: 0.2rem 0;
    border-bottom: 1px solid var(--colour-border);
`;

const Kind = styled.span`
    color: var(--colour-muted);
`;

function Entries({ title, entries }: { readonly title: string; readonly entries: readonly LibraryEntry[] }) {
    return (
        <section aria-label={title}>
            <Heading>{title}</Heading>
            <List>
                {entries.map((entry) => (
                    <Item key={`${entry.name}/${entry.stock ? "stock" : "saved"}`}>
                        <span>{entry.name}</span>
                        <Kind>{entry.stock ? "stock" : "saved"}</Kind>
                    </Item>
                ))}
            </List>
        </section>
    );
}

/** The ships and fleets every page can open: the stock ones, and the ones saved here or on another page. */
export function LibraryPage() {
    const { ships, fleets } = useLibrary();
    return (
        <Main>
            <Entries title="Ships" entries={ships.list()} />
            <Entries title="Fleets" entries={fleets.list()} />
        </Main>
    );
}
