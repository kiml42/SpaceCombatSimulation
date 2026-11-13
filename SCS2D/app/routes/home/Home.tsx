import { styled } from "@linaria/react";
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { AbandonDialog } from "~/features/skirmish/AbandonDialog";
import { downloadSkirmish, skirmishStatus, skirmishTitle } from "~/features/skirmish/skirmishFile";
import { useSkirmish } from "~/features/skirmish/SkirmishProvider";
import { useStorage } from "~/features/storage/StorageContext";
import { keptSettings } from "../skirmish/SetupScreen";

export interface PageLink {
    readonly href: string;
    readonly name: string;
    readonly purpose: string;
}

/** The free-play tools: no skirmish, no enemy answering back. */
export const SANDBOX: readonly PageLink[] = [
    { href: "#/simulator", name: "Simulator", purpose: "Set up any battle and watch it play out" },
    { href: "#/fleet", name: "Fleet editor", purpose: "Lay out a fleet of ships" },
    { href: "#/ship", name: "Ship editor", purpose: "Design a ship, module by module" },
];

export const MORE: readonly PageLink[] = [
    { href: "#/library", name: "Library", purpose: "The ships and fleets you have saved" },
    { href: "#/evolution", name: "Evolution", purpose: "Breed ships and fleets" },
    { href: "#/effects", name: "Effects", purpose: "See how hits, beams, flames and leaks are drawn" },
];

const Main = styled.main`
    position: relative;
    overflow: auto;
`;

/** Behind the menu and out of its way: seen, never read or clicked. */
const Backdrop = styled.div`
    position: absolute;
    inset: 0;
    z-index: 0;
    overflow: hidden;
    pointer-events: none;
`;

const Menu = styled.div`
    position: relative;
    z-index: 1;
    display: grid;
    gap: 1.8rem;
    max-width: 40rem;
    margin: 0 auto;
    padding: 3rem 1.5rem 2rem;
`;

const Title = styled.h1`
    margin: 0;
    color: var(--colour-heading);
    font-size: 1.8rem;
    font-weight: 600;
    letter-spacing: 0.04em;
`;

const Pitch = styled.p`
    margin: 0.4rem 0 0;
    color: var(--colour-muted);
`;

const Play = styled.section`
    display: grid;
    gap: 0.6rem;
`;

const Big = styled.a`
    display: block;
    padding: 0.9rem 1.2rem;
    border: 1px solid var(--colour-primary-border);
    border-radius: 6px;
    background: var(--colour-primary);
    color: #fff;
    text-decoration: none;

    &:hover {
        background: var(--colour-primary-hover);
    }

    strong {
        display: block;
        font-size: 1.15rem;
    }

    span {
        display: block;
        margin-top: 0.15rem;
        color: rgb(255 255 255 / 85%);
    }
`;

const Secondary = styled.button`
    justify-self: start;
    padding: 0.45rem 1rem;
    border: 1px solid var(--colour-control-border);
    border-radius: 6px;
    background: var(--colour-surface);
    color: var(--colour-text);
    cursor: pointer;

    &:hover {
        background: var(--colour-surface-hover);
    }
`;

const Heading = styled.h2`
    margin: 0 0 0.6rem;
    color: var(--colour-muted);
    font-size: var(--font-size-small);
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
`;

const Cards = styled.ul`
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
    gap: 0.6rem;
    margin: 0;
    padding: 0;
    list-style: none;

    a {
        display: block;
        height: 100%;
        padding: 0.6rem 0.8rem;
        border: 1px solid var(--colour-control-border);
        border-radius: 6px;
        background: var(--colour-surface);
        color: var(--colour-heading);
        font-weight: 600;
        text-decoration: none;
    }

    a:hover {
        background: var(--colour-surface-hover);
    }

    span {
        display: block;
        margin-top: 0.2rem;
        color: var(--colour-muted);
        font-size: var(--font-size-small);
        font-weight: 400;
    }
`;

const Footer = styled.nav`
    display: flex;
    flex-wrap: wrap;
    gap: 1.2rem;
    padding-top: 1rem;
    border-top: 1px solid var(--colour-border);
    font-size: var(--font-size-small);

    a {
        color: var(--colour-muted);
    }
`;

/** The skirmish under way, as the menu offers it. */
export interface Continuing {
    readonly title: string;
    readonly status: string;
}

export interface MainMenuProps {
    readonly current: Continuing | null;
    readonly onNewSkirmish: () => void;
    /** Drawn behind the menu, as a battle playing out might be. */
    readonly backdrop?: ReactNode;
}

/** The game's front page: the skirmish first, then the sandbox, then the rest. */
export function MainMenu({ current, onNewSkirmish, backdrop }: MainMenuProps) {
    return (
        <Main>
            {backdrop !== undefined && <Backdrop aria-hidden="true">{backdrop}</Backdrop>}
            <Menu>
                <header>
                    <Title>Space Combat Simulation</Title>
                    <Pitch>Design ships, build a fleet, and beat an enemy that evolves to beat you back.</Pitch>
                </header>
                <Play aria-label="Skirmish">
                    {current === null ? (
                        <Big href="#/skirmish">
                            <strong>Start a skirmish</strong>
                            <span>Build a fleet to beat an enemy that answers back</span>
                        </Big>
                    ) : (
                        <>
                            <Big href="#/skirmish">
                                <strong>Continue: {current.title}</strong>
                                <span>{current.status}</span>
                            </Big>
                            <Secondary type="button" onClick={onNewSkirmish}>
                                New skirmish
                            </Secondary>
                        </>
                    )}
                </Play>
                <section aria-labelledby="sandboxHeading">
                    <Heading id="sandboxHeading">Sandbox</Heading>
                    <Cards>
                        {SANDBOX.map((page) => (
                            <li key={page.href}>
                                <a href={page.href}>
                                    {page.name}
                                    <span>{page.purpose}</span>
                                </a>
                            </li>
                        ))}
                    </Cards>
                </section>
                <Footer aria-label="More">
                    {MORE.map((page) => (
                        <a key={page.href} href={page.href} title={page.purpose}>
                            {page.name}
                        </a>
                    ))}
                </Footer>
            </Menu>
        </Main>
    );
}

/** The main menu, offering the skirmish kept in storage. */
export function Home() {
    const skirmishes = useSkirmish();
    const storage = useStorage();
    const navigate = useNavigate();
    const [asking, setAsking] = useState(false);
    const { skirmish } = skirmishes;
    const current = skirmish === null ? null : { title: skirmishTitle(skirmish), status: skirmishStatus(skirmish) };

    return (
        <>
            <MainMenu current={current} onNewSkirmish={() => setAsking(true)} />
            {current !== null && (
                <AbandonDialog
                    open={asking}
                    title={current.title}
                    status={current.status}
                    onExport={() => downloadSkirmish(keptSettings(storage), skirmish, skirmishes.history)}
                    onAbandon={() => {
                        setAsking(false);
                        skirmishes.abandon();
                        void navigate("/skirmish");
                    }}
                    onCancel={() => setAsking(false)}
                />
            )}
        </>
    );
}
