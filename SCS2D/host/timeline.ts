import { Snapshot, type Fleet } from "../sim/index.js";
import { fitScale } from "../render/camera.js";
import { sidesOf, teamColour } from "../render/teams.js";
import { chains, fleetOf, type Chain, type History, type MatchRow } from "../scenarios/history.js";
import { drawCentred, formationSnapshot, kindSnapshot, pictureOf, type Picture } from "./fleetPicture.js";

/**
 * The skirmish's timeline: every match, newest first, each side drawn as the
 * Evolution route draws a combatant, the player's side stamped with how it
 * did. A run of matches the same side lost folds away to one line, but for
 * the run still being fought.
 */

/** One kind of ship, and a whole fleet, as drawn in a row, CSS pixels. */
const KIND_WIDTH = 56;
const KIND_HEIGHT = 34;
const FORMATION_WIDTH = 64;
const FORMATION_HEIGHT = 40;
/** Fleets drawn and kept, so a long history does not compile every design it ever held. */
const PICTURES_KEPT = 200;

export interface TimelineActions {
    watch(row: MatchRow, player: Fleet, enemy: Fleet): void;
    save(fleet: Fleet): void;
    exportFleet(fleet: Fleet): void;
}

export interface Timeline {
    /** Show a history; `leading` if its newest row is only the enemy leading a generation still being fought. */
    show(history: History, leading?: boolean): void;
}

export function timeline(box: HTMLElement, actions: TimelineActions): Timeline {
    const pictures = new Map<string, Picture>();
    const scratch = new Snapshot();
    /** Folded runs opened, by where they start, so a redraw keeps them open. */
    const opened = new Set<number>();
    let history: History | null = null;
    /** The row of the enemy leading a generation still being fought, drawn without a stamp. */
    let leadingRow: MatchRow | null = null;

    const picture = (id: string, fleet: Fleet): Picture => {
        let held = pictures.get(id);
        if (held === undefined) {
            held = pictureOf(fleet);
            pictures.set(id, held);
            if (pictures.size > PICTURES_KEPT) pictures.delete(pictures.keys().next().value!);
        }
        return held;
    };

    const ratio = (): number => window.devicePixelRatio || 1;
    const canvas = (width: number, height: number): HTMLCanvasElement => {
        const made = document.createElement("canvas");
        made.width = Math.round(width * ratio());
        made.height = Math.round(height * ratio());
        made.style.width = `${width}px`;
        made.style.height = `${height}px`;
        return made;
    };

    /** One side of a match: the player's stamp, its name and version, its pictures and what can be done with it. */
    const side = (row: MatchRow, which: 0 | 1, scales: { kind: number; formation: number }): HTMLElement => {
        const out = document.createElement("div");
        out.className = "combatant";
        // Only the player's side is stamped, so a stamp reads as how the player did.
        const stamp = document.createElement("span");
        if (which === 0 && row !== leadingRow) {
            const won = row.winner === 0;
            stamp.className = `stamp ${won ? "won" : row.winner < 0 ? "drew" : "beaten"}`;
            stamp.textContent = won ? "VICTORY" : row.winner < 0 ? "DRAW" : "DEFEAT";
        }
        const name = document.createElement("div");
        name.className = "who";
        const swatch = document.createElement("span");
        swatch.className = "swatch";
        const fleets = [row.player, row.enemy].map((each) => (history === null ? null : fleetOf(history, each)));
        swatch.style.background = teamColour(which, sidesOf(fleets.map((fleet) => fleet?.livery)));
        const title = which === 0 ? `Your fleet v${row.playerVersion}` : `Enemy v${row.enemyVersion}`;
        const label = document.createElement("b");
        label.textContent = title;
        const named = document.createElement("span");
        named.className = "muted";
        const ships = which === 0 ? row.playerShips : row.enemyShips;
        named.textContent = ` ${which === 0 ? row.playerName : row.enemyName} · ${ships} ship${ships === 1 ? "" : "s"}`;
        name.append(swatch, label, named);
        out.append(stamp, name);

        const id = which === 0 ? row.player : row.enemy;
        const fleet = history === null ? null : fleetOf(history, id);
        if (fleet === null || id === null) {
            const gone = document.createElement("div");
            gone.className = "muted";
            gone.textContent = "Not kept, to make room.";
            out.append(gone);
            return out;
        }
        const drawn = picture(id, fleet);
        const pictures = document.createElement("div");
        pictures.className = "pictures";
        const whole = canvas(FORMATION_WIDTH, FORMATION_HEIGHT);
        whole.title = "how it is arranged";
        // The enemy as it sets out in the battle, facing the player's fleet.
        const turned = which === 1;
        drawCentred(whole, (into) => formationSnapshot(drawn, into, turned), scales.formation);
        pictures.append(whole);
        for (const kind of drawn.kinds) {
            const tile = document.createElement("span");
            tile.className = "kind";
            const hull = canvas(KIND_WIDTH, KIND_HEIGHT);
            hull.title = kind.name;
            drawCentred(hull, (into) => kindSnapshot(kind, into, turned), scales.kind);
            tile.append(hull);
            if (kind.count > 1) {
                const count = document.createElement("span");
                count.className = "count";
                count.textContent = `×${kind.count}`;
                tile.append(count);
            }
            pictures.append(tile);
        }
        const buttons = document.createElement("span");
        buttons.className = "row-buttons";
        const saveButton = document.createElement("button");
        saveButton.textContent = "Save";
        saveButton.title = "Save this fleet to your library";
        saveButton.addEventListener("click", () => actions.save(fleet));
        const exportButton = document.createElement("button");
        exportButton.textContent = "Export";
        exportButton.title = "Download this fleet as a file";
        exportButton.addEventListener("click", () => actions.exportFleet(fleet));
        buttons.append(saveButton, exportButton);
        out.append(pictures, buttons);
        return out;
    };

    const what = (row: MatchRow): string => {
        if (row.kind === "try") return `Round ${row.round}`;
        if (row === leadingRow) return `Round ${row.round} · evolving, generation ${row.generation ?? "?"}, leading so far`;
        if (row.kind === "search") return `Round ${row.round} · evolving, generation ${row.generation ?? "?"}`;
        return `Round ${row.round} · the enemy's answer`;
    };

    const matchRow = (row: MatchRow, scales: { kind: number; formation: number }): HTMLElement => {
        const out = document.createElement("div");
        out.className = row === leadingRow ? "match leading" : `match ${row.winner === 0 ? "player-won" : "enemy-won"}`;
        const head = document.createElement("div");
        head.className = "match-head";
        const label = document.createElement("span");
        label.textContent = what(row);
        if (row.kind === "search") label.title = "Fought under evolution's rules: up to 180 s, the side ahead then taken to win.";
        head.append(label);
        const player = history === null ? null : fleetOf(history, row.player);
        const enemy = history === null ? null : fleetOf(history, row.enemy);
        if (player !== null && enemy !== null) {
            const watch = document.createElement("button");
            watch.textContent = "Watch";
            watch.title = "Fight this match again on the battle view";
            watch.addEventListener("click", () => actions.watch(row, player, enemy));
            head.append(watch);
        }
        out.append(head, side(row, 0, scales), side(row, 1, scales));
        return out;
    };

    /** The scales every row is drawn at, so a hull twice the size of another looks it. */
    const scalesFor = (rows: readonly MatchRow[]): { kind: number; formation: number } => {
        let kind = Infinity;
        let formation = Infinity;
        for (const row of rows) {
            for (const id of [row.player, row.enemy]) {
                const fleet = history === null ? null : fleetOf(history, id);
                if (fleet === null || id === null) continue;
                const drawn = picture(id, fleet);
                for (const k of drawn.kinds) {
                    kind = Math.min(kind, fitScale(kindSnapshot(k, scratch), KIND_WIDTH * ratio(), KIND_HEIGHT * ratio()));
                }
                formation = Math.min(
                    formation,
                    fitScale(formationSnapshot(drawn, scratch), FORMATION_WIDTH * ratio(), FORMATION_HEIGHT * ratio()),
                );
            }
        }
        return { kind: Number.isFinite(kind) ? kind : 1, formation: Number.isFinite(formation) ? formation : 1 };
    };

    const folded = (chain: Chain, rows: readonly MatchRow[]): HTMLElement => {
        const details = document.createElement("details");
        details.className = "chain";
        const summary = document.createElement("summary");
        const count = chain.end - chain.start;
        summary.textContent = `${chain.loser === 0 ? "You" : "The enemy"} lost ${count} in a row`;
        summary.className = chain.loser === 0 ? "player-lost" : "enemy-lost";
        details.append(summary);
        // Drawn only once opened: a long run is a lot of hulls nobody may look at.
        const fill = (): void => {
            if (details.childElementCount > 1) return;
            const slice = rows.slice(chain.start, chain.end);
            const scales = scalesFor(slice);
            for (let i = slice.length - 1; i >= 0; i--) details.append(matchRow(slice[i]!, scales));
        };
        details.addEventListener("toggle", () => {
            if (details.open) {
                opened.add(chain.start);
                fill();
            } else opened.delete(chain.start);
        });
        if (opened.has(chain.start)) {
            details.open = true;
            fill();
        }
        return details;
    };

    return {
        show(next, leading = false) {
            history = next;
            leadingRow = leading ? (next.rows[next.rows.length - 1] ?? null) : null;
            box.replaceChildren();
            const rows = next.rows;
            if (rows.length === 0) {
                const none = document.createElement("p");
                none.className = "muted";
                none.textContent = "No matches yet.";
                box.append(none);
                return;
            }
            const all = chains(rows);
            const current = all[all.length - 1]!;
            // Every row on show at one scale: the run still being fought, and the runs of one.
            const shown = rows.filter(
                (_, i) => i >= current.start || all.some((chain) => chain.start === i && chain.end - chain.start === 1),
            );
            const scales = scalesFor(shown);
            // Newest first: the run still being fought, then the rest folded.
            for (let i = current.end - 1; i >= current.start; i--) box.append(matchRow(rows[i]!, scales));
            for (let c = all.length - 2; c >= 0; c--) {
                const chain = all[c]!;
                if (chain.end - chain.start === 1) box.append(matchRow(rows[chain.start]!, scales));
                else box.append(folded(chain, rows));
            }
        },
    };
}
