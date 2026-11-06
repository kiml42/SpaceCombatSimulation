import { RESOURCE_COLOURS } from "../render/resources.js";
import { cardById, cardResource, effectText, isResource, isSimple, type Card } from "../skirmish/cards.js";

/**
 * An upgrade card as drawn wherever it is shown: one face, sized in ems from
 * a single font size, so a card large to pick and one small in a hand are the
 * same card zoomed in or out. Plain DOM, so the React pages and the timeline,
 * which builds its own markup, draw the very same card.
 */

/** A card's font size at scale 1, px. */
const BASE_PX = 12;

/** The scales a card is shown at: to pick one, and held. */
export const PICK_SCALE = 1.4;
export const HELD_SCALE = 0.7;

/** Copies drawn behind a pile's top card, however many it holds. */
const MOST_BEHIND = 3;

/** The card's own box, the same at every size. */
function face(card: Card): HTMLElement {
    const resource = cardResource(card);
    const out = document.createElement("div");
    out.className = "upgrade-card";
    out.dataset["card"] = card.id;
    Object.assign(out.style, {
        position: "relative",
        display: "flex",
        flexDirection: "column",
        width: "9em",
        height: "12.6em",
        padding: "0.7em 0.6em",
        border: `0.25em solid ${resource === null ? "var(--colour-control-border)" : RESOURCE_COLOURS[resource]}`,
        borderRadius: "0.6em",
        background: "var(--colour-surface)",
        boxShadow: "0 0.15em 0.4em #0008",
        color: "var(--colour-text)",
        textAlign: "center",
        lineHeight: "1.3",
    } satisfies Partial<CSSStyleDeclaration>);
    const name = document.createElement("div");
    name.className = "card-name";
    name.textContent = card.name;
    Object.assign(name.style, {
        paddingBottom: "0.5em",
        borderBottom: "0.08em solid var(--colour-border)",
        color: "var(--colour-heading)",
        fontSize: "1.1em",
        fontWeight: "700",
    });
    const effects = document.createElement("div");
    Object.assign(effects.style, {
        display: "flex",
        flex: "1",
        flexDirection: "column",
        gap: "0.4em",
        justifyContent: "center",
    });
    for (const effect of card.effects) {
        const { amount, limit, word } = effectText(effect);
        const line = document.createElement("div");
        line.className = "card-effect";
        const named = document.createElement("span");
        named.textContent = word;
        if (isResource(limit)) {
            named.style.color = RESOURCE_COLOURS[limit];
            named.style.fontWeight = "700";
        }
        line.append(`${amount} `, named);
        effects.append(line);
    }
    const kind = document.createElement("div");
    kind.textContent = isSimple(card) ? "upgrade" : "trade-off";
    Object.assign(kind.style, { color: "var(--colour-faint)", fontSize: "0.75em", letterSpacing: "0.1em" });
    out.append(name, effects, kind);
    return out;
}

/**
 * A card at `scale`, with `count` copies of it stacked as an offset pile and
 * counted when there is more than one. A card the deck no longer has is a
 * blank one named by its id.
 */
export function cardPile(id: string, scale: number, count = 1): HTMLElement {
    const card = cardById(id) ?? { id, name: id, effects: [] };
    const behind = Math.min(MOST_BEHIND, count - 1);
    const out = document.createElement("div");
    out.className = "card-pile";
    out.title = count > 1 ? `${card.name}, ×${count}` : card.name;
    Object.assign(out.style, {
        position: "relative",
        display: "inline-block",
        flex: "none",
        fontSize: `${BASE_PX * scale}px`,
        paddingRight: `${behind * 0.35}em`,
        paddingBottom: `${behind * 0.35}em`,
    });
    // Drawn back to front, each copy a little further down and right.
    for (let i = behind; i > 0; i--) {
        const copy = face(card);
        copy.setAttribute("aria-hidden", "true");
        Object.assign(copy.style, { position: "absolute", left: `${i * 0.35}em`, top: `${i * 0.35}em` });
        out.append(copy);
    }
    out.append(face(card));
    if (count > 1) {
        const badge = document.createElement("span");
        badge.className = "card-count";
        badge.textContent = `×${count}`;
        Object.assign(badge.style, {
            position: "absolute",
            top: "-0.4em",
            right: "-0.4em",
            padding: "0.1em 0.45em",
            borderRadius: "1em",
            background: "var(--colour-heading)",
            color: "var(--colour-background)",
            fontSize: "0.9em",
            fontWeight: "700",
        });
        out.append(badge);
    }
    return out;
}

/** Cards held, each id once as a pile of its copies, in the order each was first taken. */
export function piles(ids: readonly string[]): { readonly id: string; readonly count: number }[] {
    const counts = new Map<string, number>();
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    return [...counts].map(([id, count]) => ({ id, count }));
}
