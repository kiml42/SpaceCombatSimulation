import { styled } from "@linaria/react";

export interface PageLink {
    readonly href: string;
    readonly name: string;
    readonly purpose: string;
}

/** Every screen, by its hash route. */
export const SCREENS: readonly PageLink[] = [
    { href: "#/battle", name: "Battle", purpose: "Fight a battle, or set one up" },
    { href: "#/fleet", name: "Fleet", purpose: "Lay a fleet out" },
    { href: "#/ship", name: "Ship", purpose: "Design a ship" },
    { href: "#/skirmish", name: "Skirmish", purpose: "Build a fleet to beat an enemy that answers back" },
    { href: "#/evolution", name: "Evolution", purpose: "Breed ships and fleets" },
    { href: "#/library", name: "Library", purpose: "The ships and fleets you have saved" },
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

export function Home({ pages = SCREENS }: { readonly pages?: readonly PageLink[] }) {
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
