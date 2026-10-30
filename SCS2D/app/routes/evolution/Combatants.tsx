import { styled } from "@linaria/react";
import { useEffect, useState } from "react";
import { drawCentred, formationSnapshot, kindSnapshot, type Picture } from "~/host/fleetPicture";
import { easeScale, fitScale } from "~/render/camera";
import { teamColour } from "~/render/canvas2d";
import { Snapshot } from "~/sim/index";
import type { Row } from "./runView";

/**
 * The box one kind of ship is drawn in, CSS pixels: one ship rather than a
 * whole fleet, which drawn entire is a scattering of specks at any size that
 * fits a row.
 */
const TILE_WIDTH = 88;
const TILE_HEIGHT = 52;
/**
 * The box a whole fleet is drawn in, on a scale of its own shared across the
 * rows: one scale for both would put a formation a kilometre across and a
 * hull ten metres long on the same ruler.
 */
const FORMATION_WIDTH = 88;
const FORMATION_HEIGHT = 64;
/** How much of the way a scale closes on its target each frame. */
const EASE = 0.15;

/** The five parts a score is made of, in the order they are shown, in the colours the chart plots them in. */
export const SCORE_COLUMNS = [
    { css: "hull", head: "hull", title: "hull kept", of: (row: Row): number => row.survival },
    { css: "func", head: "func", title: "function kept", of: (row: Row): number => row.functional },
    { css: "dmg", head: "dmg", title: "damage done", of: (row: Row): number => row.damage },
    { css: "dis", head: "dis", title: "function taken", of: (row: Row): number => row.disabling },
    { css: "grnd", head: "grnd", title: "ground gained", of: (row: Row): number => row.race },
] as const;
/** Two parts a column, so a row's height is used and two sides' tables fit beside each other. */
const STACKED: readonly (readonly number[])[] = [[0, 1], [2, 3], [4]];

const Box = styled.div`
    position: absolute;
    inset: 0;
    padding: 0.2rem 0 1rem;
    overflow: auto;

    .none {
        padding: 0.5rem 0.2rem;
        color: var(--colour-muted);
    }

    .pair {
        display: flex;
        gap: 1rem;
        align-items: flex-start;
    }

    table {
        flex: 1 1 0;
        min-width: max-content;
        border-collapse: collapse;
    }

    th {
        position: sticky;
        top: 0;
        padding: 0.1rem 0.35rem 0.25rem;
        background: var(--colour-background);
        color: var(--colour-muted);
        font-weight: 400;
        text-align: right;
        white-space: nowrap;
    }

    th.who,
    th.formation,
    th.made,
    th.done {
        text-align: left;
    }

    th.part {
        vertical-align: bottom;
        line-height: 1.2;
    }

    /* Every row one height, so a design with more kinds than the rest scrolls within its cell rather than shifting the rows below. */
    td {
        padding: 0.3rem 0.35rem;
        color: var(--colour-text);
        text-align: right;
        vertical-align: top;
        white-space: nowrap;
    }

    tbody tr {
        height: 6rem;
        border-top: 1px solid var(--colour-border);
        cursor: pointer;
    }

    tbody tr:hover td {
        background: #101825;
    }

    tbody tr.picked td {
        background: #16202e;
    }

    td.who {
        text-align: left;
    }

    td.who b {
        color: var(--colour-heading);
        font-weight: 600;
    }

    td.who .from {
        display: block;
        color: var(--colour-muted);
    }

    tr.champion td.score {
        color: var(--colour-ok);
    }

    td.score .count {
        color: var(--colour-muted);
        font-size: 10px;
    }

    td.score button {
        margin-top: 4px;
        padding: 0 4px;
        font-size: 10px;
    }

    td.part div {
        line-height: 1.5;
    }

    td.formation {
        padding-right: 0.7rem;
        text-align: left;
    }

    canvas {
        display: block;
        border-radius: 3px;
        background: #0d1219;
    }

    td.formation canvas {
        border: 1px solid #141c28;
    }

    /* No floor on the column: the kinds wrap on a narrow window rather than cutting the last column off. */
    td.made {
        text-align: left;
        white-space: normal;
    }

    .kinds,
    td.done div {
        height: 5.4rem;
        overflow-y: auto;
        scrollbar-width: thin;
    }

    .kinds {
        display: flex;
        flex-wrap: wrap;
        gap: 0.3rem 0.2rem;
        align-items: flex-start;
    }

    .kind {
        width: 5.5rem;
    }

    .kind .of {
        display: block;
        color: var(--colour-muted);
        line-height: 1.25;
        text-align: center;
    }

    .kind .of b {
        color: var(--colour-text);
        font-weight: 600;
    }

    /* Capped on the div rather than the cell, which a table in automatic layout lets grow past its container. */
    td.done {
        color: var(--colour-muted);
        text-align: left;
        white-space: normal;
    }

    td.done div {
        max-width: 10rem;
        overflow-wrap: anywhere;
    }

    .hull {
        color: #7fd6a0;
    }

    .func {
        color: #b48ee0;
    }

    .dmg {
        color: #e0655f;
    }

    .dis {
        color: #e08ec0;
    }

    .grnd {
        color: #e9c05f;
    }
`;

/** A row's canvases and the scales they were last drawn at. */
interface Drawn {
    readonly picture: Picture;
    readonly kinds: (HTMLCanvasElement | null)[];
    formation: HTMLCanvasElement | null;
    drawnAt: number;
    formationDrawnAt: number;
    /** Made once, so React hands each canvas over once rather than at every render. */
    readonly formationRef: (canvas: HTMLCanvasElement | null) => void;
    readonly kindRefs: readonly ((canvas: HTMLCanvasElement | null) => void)[];
}

/**
 * Every row's pictures, by design, and the two scales they are drawn at,
 * eased towards whatever fits the largest on show. A design never changes, so
 * its pictures are redrawn only while a scale moves.
 */
class Tiles {
    private readonly held = new Map<string, Drawn>();
    private readonly shot = new Snapshot();
    private fleet = 0;
    private fleetTarget = 0;
    private formation = 0;
    private formationTarget = 0;

    /** Keep the rows on show and aim the scales at what fits them. */
    sync(rows: readonly Row[], picture: (row: Row) => Picture, ratio: number): void {
        const live = new Set(rows.map(keyOf));
        for (const key of [...this.held.keys()]) if (!live.has(key)) this.held.delete(key);
        let fleetTarget = Infinity;
        let formationTarget = Infinity;
        for (const row of rows) {
            const held = this.of(row, picture);
            for (const kind of held.picture.kinds) {
                fleetTarget = Math.min(fleetTarget, fitScale(kindSnapshot(kind, this.shot), TILE_WIDTH * ratio, TILE_HEIGHT * ratio));
            }
            const whole = formationSnapshot(held.picture, this.shot);
            formationTarget = Math.min(formationTarget, fitScale(whole, FORMATION_WIDTH * ratio, FORMATION_HEIGHT * ratio));
        }
        if (rows.length === 0) return;
        this.fleetTarget = fleetTarget;
        this.formationTarget = formationTarget;
    }

    of(row: Row, picture: (row: Row) => Picture): Drawn {
        const key = keyOf(row);
        const found = this.held.get(key);
        if (found !== undefined) return found;
        const made = picture(row);
        const held: Drawn = {
            picture: made,
            kinds: [],
            formation: null,
            drawnAt: 0,
            formationDrawnAt: 0,
            formationRef: (canvas) => {
                held.formation = canvas;
                held.formationDrawnAt = 0;
            },
            kindRefs: made.kinds.map((_, i) => (canvas: HTMLCanvasElement | null) => {
                held.kinds[i] = canvas;
                held.drawnAt = 0;
            }),
        };
        this.held.set(key, held);
        return held;
    }

    /** Ease the scales a frame's worth, and redraw whatever is not drawn at them. */
    frame(): void {
        if (this.fleetTarget > 0) this.fleet = easeScale(this.fleet, this.fleetTarget, EASE);
        if (this.formationTarget > 0) this.formation = easeScale(this.formation, this.formationTarget, EASE);
        for (const held of this.held.values()) {
            if (held.formation !== null && held.formationDrawnAt !== this.formation) {
                drawCentred(held.formation, (into) => formationSnapshot(held.picture, into), this.formation);
                held.formationDrawnAt = this.formation;
            }
            if (held.drawnAt === this.fleet) continue;
            held.picture.kinds.forEach((kind, i) => {
                const canvas = held.kinds[i];
                if (canvas) drawCentred(canvas, (into) => kindSnapshot(kind, into), this.fleet);
            });
            held.drawnAt = this.fleet;
        }
    }
}

const keyOf = (row: Row): string => (row.id >= 0 ? String(row.id) : `${row.id}:${row.entrant.name}`);

export interface CombatantsProps {
    readonly rows: readonly Row[];
    /** Why there are none, where there are none. */
    readonly empty: string;
    readonly picture: (row: Row) => Picture;
    readonly picked: number;
    readonly onPick: (id: number) => void;
    readonly onExport: (row: Row) => void;
    /** Matches each design owes before a count says how many it won. */
    readonly owed: number;
}

/**
 * Every design of a generation, best first, a row each: what it is made of,
 * what it scored, and what was done to make it. Side by side in a co-evolution
 * run, each ranked within its own lineage, since a score is against the other side.
 *
 * Every hull on show is drawn at one scale, eased towards whatever fits the
 * largest, so a ship twice the size of another looks it and seeking through a
 * run shows the ships growing. A design never changes, so its pictures are
 * redrawn only while the scale moves.
 */
export function Combatants({ rows, empty, picture, picked, onPick, onExport, owed }: CombatantsProps) {
    const [tiles] = useState(() => new Tiles());
    const ratio = window.devicePixelRatio || 1;
    tiles.sync(rows, picture, ratio);

    useEffect(() => {
        let request = 0;
        const frame = (): void => {
            request = window.requestAnimationFrame(frame);
            tiles.frame();
        };
        request = window.requestAnimationFrame(frame);
        return () => window.cancelAnimationFrame(request);
    }, [tiles]);

    if (rows.length === 0) {
        return (
            <Box id="fleet">
                <p className="none">{empty}</p>
            </Box>
        );
    }

    const ranked = [...rows].sort((a, b) => (a.side ?? 0) - (b.side ?? 0) || b.fitness - a.fitness);
    const sides = [ranked.filter((row) => row.side !== 1), ranked.filter((row) => row.side === 1)];
    const canvasSize = (width: number, height: number) => ({
        width: Math.round(width * ratio),
        height: Math.round(height * ratio),
        style: { width: `${width}px`, height: `${height}px` },
    });

    const line = (row: Row, rank: number) => {
        const held = tiles.of(row, picture);
        const ships = held.picture.view.ships.length;
        const wins = row.wins;
        const fought = row.id >= 0 && row.matches > 0;
        return (
            <tr
                key={keyOf(row)}
                className={[row.id === picked ? "picked" : "", rank === 0 && fought ? "champion" : ""].join(" ").trim()}
                onClick={() => onPick(row.id)}
            >
                <td className="who">
                    {row.side !== undefined && (
                        <span
                            className="side"
                            style={{ color: teamColour(row.side) }}
                            title={row.side === 0 ? "side A: the founders' lineage" : "side B: the lineage bred against it"}
                        >
                            {row.side === 0 ? "A " : "B "}
                        </span>
                    )}
                    {/* A preview's founders have no id yet; their names say more. */}
                    <b>{row.id < 0 ? row.entrant.name : `${rank + 1}. #${row.id}`}</b>
                    {row.id >= 0 && (
                        <span className="from" title={row.parent >= 0 ? `bred from #${row.parent}` : undefined}>
                            {row.parent < 0 ? "a founder" : `← #${row.parent}`}
                        </span>
                    )}
                </td>
                <td className="formation">
                    <canvas
                        ref={held.formationRef}
                        title={`${ships} ship${ships === 1 ? "" : "s"} in formation`}
                        {...canvasSize(FORMATION_WIDTH, FORMATION_HEIGHT)}
                    />
                </td>
                <td className="made">
                    <div className="kinds" tabIndex={0}>
                        {held.picture.kinds.map((kind, i) => (
                            <div className="kind" key={kind.name}>
                                <canvas ref={held.kindRefs[i]} {...canvasSize(TILE_WIDTH, TILE_HEIGHT)} />
                                <span className="of" title={`${kind.count} × ${kind.name}`}>
                                    {/* No count on a lone ship: "×1" under one hull is noise. */}
                                    {kind.count > 1 && <b>{`×${kind.count} `}</b>}
                                    {kind.name}
                                </span>
                            </div>
                        ))}
                    </div>
                </td>
                <td
                    className="score"
                    title={
                        row.id < 0
                            ? ""
                            : `${row.matches} match${row.matches === 1 ? "" : "es"} fought` +
                              (wins === undefined ? "" : `, ${wins.won} of ${wins.fought} won outright, drills aside`)
                    }
                >
                    <div className="figure">{row.id < 0 ? "" : row.matches > 0 ? row.fitness.toFixed(3) : "—"}</div>
                    <div className="count">
                        {row.id < 0
                            ? ""
                            : row.matches < owed
                              ? `${row.matches}/${owed}`
                              : wins !== undefined
                                ? `won ${wins.won}/${wins.fought}`
                                : ""}
                    </div>
                    <button
                        type="button"
                        className="export"
                        title={`Save ${row.entrant.name} as a file`}
                        onClick={(event) => {
                            // Not a pick of the row as well.
                            event.stopPropagation();
                            onExport(row);
                        }}
                    >
                        export
                    </button>
                </td>
                {STACKED.map((stack) => (
                    <td className="part" key={stack.join()}>
                        {stack.map((i) => {
                            const column = SCORE_COLUMNS[i]!;
                            return (
                                <div key={column.css} className={column.css} title={column.title}>
                                    {/* A dash for a design that has not fought: its parts are as unknown as its score. */}
                                    {fought ? column.of(row).toFixed(2) : "—"}
                                </div>
                            );
                        })}
                    </td>
                ))}
                <td className="mass">{(row.mass / 1000).toFixed(1)}</td>
                <td className="done">
                    <div tabIndex={0}>{row.edits.length > 0 ? row.edits.join("; ") : row.id < 0 ? "" : "—"}</div>
                </td>
            </tr>
        );
    };

    return (
        <Box id="fleet">
            <div className="pair">
                {sides.map((side, k) => (
                    <table key={k} hidden={side.length === 0}>
                        <thead>
                            <tr>
                                <th className="who" title="rank, and what it was bred from">
                                    #
                                </th>
                                <th className="formation" title="how it is arranged, to its own scale">
                                    fleet
                                </th>
                                <th className="made" title="every kind of ship in it, and how many">
                                    made of
                                </th>
                                <th className="score" title="against this generation’s opponents">
                                    score
                                </th>
                                {STACKED.map((stack) => (
                                    <th className="part" key={stack.join()}>
                                        {stack.map((i) => {
                                            const column = SCORE_COLUMNS[i]!;
                                            return (
                                                <div key={column.css} className={column.css} title={column.title}>
                                                    {column.head}
                                                </div>
                                            );
                                        })}
                                    </th>
                                ))}
                                <th className="mass" title="tonnes">
                                    t
                                </th>
                                <th className="done" title="what was done to its parent to make it">
                                    changed
                                </th>
                            </tr>
                        </thead>
                        <tbody>{side.map((row, rank) => line(row, rank))}</tbody>
                    </table>
                ))}
            </div>
        </Box>
    );
}
