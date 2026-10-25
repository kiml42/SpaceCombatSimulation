import type { Arcs } from "../render/canvas2d.js";

/**
 * How a page shows a battle, kept between visits: which arcs are drawn (`A`),
 * whether shots are in their side's colours (`C`), whether each side's ships
 * are shown down the edges (`T`), and the speed.
 *
 * Per page, since their defaults differ. Kept in the browser only, and read
 * and written inside a try, since storage can be missing or refused: a page
 * that cannot remember simply starts from its defaults.
 */
export interface ViewSettings {
    arcs: Arcs;
    teamShots: boolean;
    strips: boolean;
    speed: number;
}

const ARCS: readonly Arcs[] = ["none", "firing", "trigger"];

export function loadView(page: string, defaults: ViewSettings): ViewSettings {
    try {
        return parseView(window.localStorage.getItem(viewKey(page)), defaults);
    } catch {
        return { ...defaults };
    }
}

/** Settings as kept, each one that is missing or unreadable taken from `defaults`. */
export function parseView(raw: string | null, defaults: ViewSettings): ViewSettings {
    if (raw === null) return { ...defaults };
    let kept: Partial<Record<keyof ViewSettings, unknown>>;
    try {
        kept = JSON.parse(raw) as Partial<Record<keyof ViewSettings, unknown>>;
    } catch {
        return { ...defaults };
    }
    if (typeof kept !== "object" || kept === null) return { ...defaults };
    return {
        arcs: ARCS.includes(kept.arcs as Arcs) ? (kept.arcs as Arcs) : defaults.arcs,
        teamShots: typeof kept.teamShots === "boolean" ? kept.teamShots : defaults.teamShots,
        strips: typeof kept.strips === "boolean" ? kept.strips : defaults.strips,
        speed: typeof kept.speed === "number" && kept.speed > 0 ? kept.speed : defaults.speed,
    };
}

export function saveView(page: string, settings: ViewSettings): void {
    try {
        window.localStorage.setItem(viewKey(page), JSON.stringify(settings));
    } catch {
        // Not remembered, which costs a visit its settings and nothing else.
    }
}

/**
 * A speed list showing the kept speed, if it is one of its own, and saving
 * whatever is picked. Returns the speed it shows.
 */
export function keepSpeed(select: HTMLSelectElement, page: string, settings: ViewSettings): number {
    const wanted = String(settings.speed);
    if ([...select.options].some((option) => option.value === wanted)) select.value = wanted;
    select.addEventListener("change", () => {
        settings.speed = Number(select.value);
        saveView(page, settings);
    });
    return Number(select.value);
}

/** Where a page's settings are kept, by the old pages and the app alike. */
export function viewKey(page: string): string {
    return `scs2d.view.${page}`;
}
