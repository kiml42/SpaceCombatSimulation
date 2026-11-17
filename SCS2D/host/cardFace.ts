import { RESOURCE_COLOURS } from "../render/resources.js";
import { cardById, cardResource, effectText, isResource, isSimple, type Card } from "../skirmish/cards.js";

/**
 * An upgrade card as drawn wherever it is shown: one face, laid out at the
 * size it is picked at and scaled down to be held, so a small card is the
 * large one shrunk rather than laid out again in less room. A held card grows
 * back to that size under the pointer. Plain DOM, so the React pages and the
 * timeline, which builds its own markup, draw the very same card.
 */

/** A card's font size at scale 1, px. */
const BASE_PX = 12;

/** The scales a card is shown at: to pick one, and held. */
export const PICK_SCALE = 1.4;
export const HELD_SCALE = 0.6;

/** Copies drawn behind a pile's top card, however many it holds. */
const MOST_BEHIND = 3;

/** A face's size and a pile's offset per copy, em. */
const WIDTH = 9;
const HEIGHT = 12.6;
const OFFSET = 0.35;

/** How long a held card takes to grow under the pointer, ms. */
const GROW_MS = 120;

/** A name's font size, em: smaller where its longest word would not fit across a card in a monospace face. */
function nameSize(name: string): number {
    const longest = Math.max(...name.split(" ").map((word) => word.length));
    return Math.min(1.1, (WIDTH - 1.8) / (0.62 * longest));
}

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
        width: `${WIDTH}em`,
        height: `${HEIGHT}em`,
        padding: "0.7em 0.6em",
        border: `0.25em solid ${resource === null ? "var(--colour-control-border)" : RESOURCE_COLOURS[resource]}`,
        borderRadius: "0.6em",
        background: "var(--colour-surface)",
        boxShadow: "0 0.15em 0.4em #0008",
        color: "var(--colour-text)",
        textAlign: "center",
        lineHeight: "1.3",
        // Its own, whatever it is put in: a table that keeps figures on one line, say.
        whiteSpace: "normal",
        overflowWrap: "anywhere",
    } satisfies Partial<CSSStyleDeclaration>);
    const name = document.createElement("div");
    name.className = "card-name";
    name.textContent = card.name;
    Object.assign(name.style, {
        paddingBottom: "0.5em",
        borderBottom: "0.08em solid var(--colour-border)",
        color: "var(--colour-heading)",
        fontSize: `${nameSize(card.name)}em`,
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
    Object.assign(kind.style, { color: "var(--colour-muted)", fontSize: "0.75em", letterSpacing: "0.1em" });
    out.append(name, effects, kind);
    return out;
}

/**
 * A card at `scale`, with `count` copies of it stacked as an offset pile and
 * counted when there is more than one. A card the deck no longer has is a
 * blank one named by its id. Below `PICK_SCALE` it is that size shrunk, and
 * grows back to it under the pointer.
 */
export function cardPile(id: string, scale: number, count = 1): HTMLElement {
    const card = cardById(id) ?? { id, name: id, effects: [] };
    const behind = Math.min(MOST_BEHIND, count - 1);
    const pile = document.createElement("div");
    pile.className = "card-pile";
    pile.title = count > 1 ? `${card.name}, ×${count}` : card.name;
    const drawn = Math.max(scale, PICK_SCALE);
    Object.assign(pile.style, {
        position: "relative",
        display: "inline-block",
        flex: "none",
        fontSize: `${BASE_PX * drawn}px`,
        paddingRight: `${behind * OFFSET}em`,
        paddingBottom: `${behind * OFFSET}em`,
    });
    // Drawn back to front, each copy a little further down and right.
    for (let i = behind; i > 0; i--) {
        const copy = face(card);
        copy.setAttribute("aria-hidden", "true");
        Object.assign(copy.style, { position: "absolute", left: `${i * OFFSET}em`, top: `${i * OFFSET}em` });
        pile.append(copy);
    }
    pile.append(face(card));
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
        pile.append(badge);
    }
    return scale >= PICK_SCALE ? pile : shrunk(pile, scale / PICK_SCALE, behind);
}

/** A pile drawn at pick size, shown `ratio` of it in a box that size, and grown back under the pointer. */
function shrunk(pile: HTMLElement, ratio: number, behind: number): HTMLElement {
    const em = BASE_PX * PICK_SCALE * ratio;
    const box = document.createElement("div");
    box.className = "card-held";
    Object.assign(box.style, {
        position: "relative",
        display: "inline-block",
        flex: "none",
        width: `${(WIDTH + behind * OFFSET) * em}px`,
        height: `${(HEIGHT + behind * OFFSET) * em}px`,
    });
    const rest = `scale(${ratio})`;
    Object.assign(pile.style, {
        position: "absolute",
        top: "0",
        left: "0",
        transformOrigin: "0 0",
        transform: rest,
        transition: reducedMotion() ? "none" : `transform ${GROW_MS}ms ease-out`,
    });
    box.append(pile);
    box.addEventListener("pointerenter", () => {
        const at = box.getBoundingClientRect();
        const room = visibleRoom(box);
        const w = at.width / ratio;
        const h = at.height / ratio;
        // Grown about its centre, kept inside what can be seen of whatever scrolls it.
        const x = clamp(at.left - (w - at.width) / 2, room.left, room.right - w) - at.left;
        const y = clamp(at.top - (h - at.height) / 2, room.top, room.bottom - h) - at.top;
        pile.style.zIndex = "10";
        pile.style.transform = `translate(${x}px, ${y}px) scale(1)`;
    });
    box.addEventListener("pointerleave", () => {
        pile.style.transform = rest;
        pile.style.zIndex = "";
    });
    return box;
}

/** The part of the window `el` can be seen in, inside every ancestor that clips it. */
function visibleRoom(el: HTMLElement): { left: number; top: number; right: number; bottom: number } {
    const room = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    for (let up = el.parentElement; up !== null; up = up.parentElement) {
        const style = getComputedStyle(up);
        if (style.overflowX === "visible" && style.overflowY === "visible") continue;
        const r = up.getBoundingClientRect();
        room.left = Math.max(room.left, r.left);
        room.top = Math.max(room.top, r.top);
        room.right = Math.min(room.right, r.right);
        room.bottom = Math.min(room.bottom, r.bottom);
    }
    return room;
}

/** `v` within `lo`..`hi`, or `lo` where there is not room for both. */
function clamp(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(v, hi));
}

function reducedMotion(): boolean {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Cards held, each id once as a pile of its copies, in the order each was first taken. */
export function piles(ids: readonly string[]): { readonly id: string; readonly count: number }[] {
    const counts = new Map<string, number>();
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    return [...counts].map(([id, count]) => ({ id, count }));
}
