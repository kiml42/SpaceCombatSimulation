import { styled } from "@linaria/react";

export interface PageLink {
    readonly href: string;
    readonly name: string;
    readonly purpose: string;
}

/** The pages bundled by `scripts/build.ts`, each until its route here replaces it. */
export const OLD_PAGES: readonly PageLink[] = [
    { href: "skirmish.html", name: "Skirmish", purpose: "Hold off an enemy that evolves to beat you" },
    { href: "evolution.html", name: "Evolution", purpose: "Breed ships and fleets" },
];

const Main = styled.main`
    max-width: 40rem;
    padding: 1.5rem;
`;

const Title = styled.h1`
    margin: 0 0 1rem;
    color: var(--colour-heading);
    font-size: 1.4rem;
    font-weight: 600;
`;

const List = styled.ul`
    display: grid;
    gap: 0.6rem;
    margin: 0;
    padding: 0;
    list-style: none;
`;

const Purpose = styled.span`
    display: block;
    color: var(--colour-muted);
`;

export function Home({ pages = OLD_PAGES }: { readonly pages?: readonly PageLink[] }) {
    return (
        <Main>
            <Title>Space Combat Simulation</Title>
            <List>
                {pages.map((page) => (
                    <li key={page.href}>
                        <a href={page.href}>{page.name}</a>
                        <Purpose>{page.purpose}</Purpose>
                    </li>
                ))}
            </List>
        </Main>
    );
}
