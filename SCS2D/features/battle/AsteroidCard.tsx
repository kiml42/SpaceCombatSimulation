import { styled } from "@linaria/react";

const Card = styled.div`
    position: absolute;
    top: 0;
    left: 0;
    padding: 0.4rem 0.7rem;
    border: 1px solid var(--colour-border);
    border-width: 0 1px 1px 0;
    background: #0b0f16d9;
`;

/** What is left in an asteroid picked out alone, or in the one the ship picked out alone is mining. */
export function AsteroidCard({ contents, mining = false }: { readonly contents: string | null; readonly mining?: boolean }) {
    if (contents === null) return null;
    return (
        <Card id="asteroidCard" role="status" aria-label="Asteroid">
            {mining ? "Mining asteroid" : "Asteroid"} {contents}
        </Card>
    );
}
