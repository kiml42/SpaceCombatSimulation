import { styled } from "@linaria/react";
import { useLayoutEffect, useRef } from "react";
import { cardPile, HELD_SCALE, PICK_SCALE, piles } from "~/host/cardFace";
import { RESOURCE_COLOURS } from "~/render/resources";
import { cardById } from "~/skirmish/cards";

/** One upgrade card, or a pile of copies of it: the face `host/cardFace.ts` draws, mounted and left alone. */
export function UpgradeCard({ id, scale, count = 1 }: { readonly id: string; readonly scale: number; readonly count?: number }) {
    const box = useRef<HTMLSpanElement>(null);
    useLayoutEffect(() => {
        box.current?.replaceChildren(cardPile(id, scale, count));
    }, [id, scale, count]);
    return <span ref={box} style={{ display: "inline-flex" }} />;
}

const Row = styled.div`
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: flex-start;
    margin: 0.3rem 0;
`;

const None = styled.p`
    margin: 0.2rem 0;
    color: var(--colour-muted);
`;

/** Cards a side holds, small, copies of one card stacked, in the order each was first taken, under `caption` if any. */
export function CardHand({
    ids,
    id,
    empty,
    caption,
}: {
    readonly ids: readonly string[];
    readonly id?: string;
    readonly empty: string;
    readonly caption?: string;
}) {
    if (ids.length === 0) return <None id={id}>{empty}</None>;
    return (
        <div id={id}>
            {caption !== undefined && <None>{caption}</None>}
            <Row role="group" aria-label={`${ids.length} upgrade ${ids.length === 1 ? "card" : "cards"}`}>
                {piles(ids).map((pile) => (
                    <UpgradeCard key={pile.id} id={pile.id} scale={HELD_SCALE} count={pile.count} />
                ))}
            </Row>
        </div>
    );
}

const Choice = styled.button`
    padding: 0;
    border: none;
    border-radius: 10px;
    background: none;
    cursor: pointer;
    transition: transform 0.1s;

    &:hover {
        background: none;
        transform: translateY(-4px);
    }

    &:focus-visible {
        outline: 2px solid var(--colour-primary-border);
        outline-offset: 3px;
    }
`;

/** A hand to pick one card from, large. */
export function CardPick({ hand, onPick }: { readonly hand: readonly string[]; readonly onPick: (id: string) => void }) {
    return (
        <Row id="cardPick" role="group" aria-label="Pick an upgrade card">
            {hand.map((id) => (
                <Choice key={id} type="button" data-pick={id} title={`Take ${cardById(id)?.name ?? id}`} onClick={() => onPick(id)}>
                    <UpgradeCard id={id} scale={PICK_SCALE} />
                </Choice>
            ))}
        </Row>
    );
}

/** A cost's name in its colour, as the cards write it. */
export function ResourceWord({ resource }: { readonly resource: keyof typeof RESOURCE_COLOURS }) {
    return <span style={{ color: RESOURCE_COLOURS[resource] }}>{resource}</span>;
}
