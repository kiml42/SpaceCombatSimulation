import { styled } from "@linaria/react";
import type { Library } from "~/editor/library";
import type { MatchRecord } from "~/evolution/run";
import { gridLabel, type ChampionGrid } from "~/evolution/yardstick";
import { teamColour } from "~/render/canvas2d";
import type { Blueprint, Fleet } from "~/sim/index";
import { Button } from "~/ui/buttons/Button";
import { Fold } from "./Fold";
import { competitorsText, endingText } from "./runView";
import { Buttons, EntrantOptions, Note } from "./SetupScreen";

const Panel = styled.aside`
    flex: 0 0 auto;
    width: 18rem;
    padding: 0.7rem 0.9rem 2rem;
    overflow-y: auto;
    border-left: 1px solid var(--colour-border);

    > details:first-of-type h2 {
        margin-top: 0;
    }

    table {
        width: 100%;
        border-collapse: collapse;
    }

    th {
        position: sticky;
        top: 0;
        padding: 0.1rem 0 0.25rem;
        background: var(--colour-background);
        color: #7f93aa;
        font-weight: 400;
        text-align: right;
    }

    td {
        padding: 0.05rem 0;
        color: var(--colour-text);
        text-align: right;
    }

    th:first-child,
    td:first-child {
        text-align: left;
    }

    tr.watched td {
        color: var(--colour-warning);
    }

    tbody tr {
        cursor: pointer;
    }

    tbody tr:hover td {
        background: #16202e;
    }

    .fighting {
        color: var(--colour-ok);
        letter-spacing: 0;
        text-transform: none;
    }

    @media (width <= 1100px) {
        width: auto;
        border-top: 1px solid var(--colour-border);
        border-left: none;
    }
`;

const Field = styled.div`
    display: flex;
    gap: 0.4rem;
    align-items: center;

    label {
        flex: 1;
        color: #7f93aa;
    }

    select {
        flex: 0 0 9rem;
        min-width: 0;
    }
`;

const Grid = styled.table`
    width: auto !important;
    margin-top: 0.4rem;
    font-size: 0.75rem;

    th,
    td {
        padding: 0.1rem 0.3rem;
        text-align: center !important;
    }

    td {
        border: 1px solid #1c2633;
    }
`;

/** Where the panel's own answer to a measurement goes, so the page says one thing at a time. */
export const OWN_FINAL = "";

export interface ResultsProps {
    readonly hidden: boolean;
    /** Which generation, counting from one, or null before a run. */
    readonly generation: number | null;
    /** Whether the generation on show is still being fought. */
    readonly fighting: boolean;
    /** Whether the panel is pinned to a generation rather than following the newest. */
    readonly pinned: boolean;
    readonly onLatest: () => void;
    readonly matches: readonly MatchRecord[];
    /** The most matches any generation has fought, which the list is padded to, so the panels under it stay put. */
    readonly longest: number;
    readonly watched: MatchRecord | null;
    readonly onWatch: (record: MatchRecord) => void;
    readonly champion: string;
    readonly hasChampion: boolean;
    readonly onSave: () => void;
    readonly onExport: () => void;
    readonly ships: Library<Blueprint>;
    readonly fleets: Library<Fleet>;
    readonly benchmark: string;
    readonly onBenchmark: (value: string) => void;
    /** Whether the run is measured as a grid of champions rather than against one opponent. */
    readonly inRounds: boolean;
    readonly canMeasure: boolean;
    readonly onMeasure: () => void;
    readonly onWatchYardstick: () => void;
    readonly yardstickLine: string;
    readonly grid: ChampionGrid | null;
}

/** The generation on show, its matches, the run's best, and what it measured against. */
export function Results(props: ResultsProps) {
    const { matches, longest, grid } = props;
    let most = 0;
    for (const row of grid?.cells ?? []) for (const cell of row) most = Math.max(most, Math.abs(cell.margin));
    const short = (point: ChampionGrid["rows"][number]): string => String((point.round ?? point.generation) + 1);

    return (
        <Panel id="results" hidden={props.hidden}>
            <Fold
                k="generation"
                title={
                    <>
                        Generation <span id="shownGeneration">{props.generation === null ? "—" : props.generation}</span>
                        <span id="fighting" className="fighting">
                            {props.fighting ? " · fighting" : ""}
                        </span>
                    </>
                }
            >
                <Buttons>
                    <Button id="latest" title="Follow the newest generation again" disabled={!props.pinned} onClick={props.onLatest}>
                        Latest
                    </Button>
                </Buttons>
                <Note>
                    Every combatant is a row in the panel to the left: what it is made of, what it scored, and what was changed to make it.
                </Note>
            </Fold>
            <Fold k="matches" title="Matches">
                <table>
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>entrants</th>
                            <th>ended</th>
                            <th>s</th>
                        </tr>
                    </thead>
                    <tbody id="matches">
                        {matches.map((record, i) => (
                            <tr key={i} className={record === props.watched ? "watched" : undefined} onClick={() => props.onWatch(record)}>
                                <td>{i + 1}</td>
                                <td>{competitorsText(record)}</td>
                                <td>{endingText(record)}</td>
                                <td>{record.elapsed.toFixed(0)}</td>
                            </tr>
                        ))}
                        {Array.from({ length: Math.max(0, longest - matches.length) }, (_, i) => (
                            <tr key={`pad${i}`} className="pad">
                                <td colSpan={4}>{" "}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <Note>Click one to watch it again — a match is replayed from its seed, so it is the match that was scored.</Note>
            </Fold>
            <Fold k="whatitarrivedat" title="What it arrived at">
                <Note id="championLine">{props.champion}</Note>
                <Buttons>
                    <Button id="saveChampion" disabled={!props.hasChampion} onClick={props.onSave}>
                        Save to editor
                    </Button>
                    <Button id="exportChampion" disabled={!props.hasChampion} onClick={props.onExport}>
                        Export
                    </Button>
                </Buttons>
                <Note>
                    The best of the latest generation. A score is against that generation&apos;s opponents, so it cannot be compared with
                    one from another generation — a population that learns to fly before it learns to shoot scores superbly until guns
                    appear, then far less while getting better.
                </Note>
            </Fold>
            <Fold k="measuredagainstoneopponent" title="Measured against one opponent">
                <Field>
                    <label htmlFor="benchmark">opponent</label>
                    <select
                        id="benchmark"
                        value={props.benchmark}
                        disabled={props.inRounds}
                        onChange={(event) => props.onBenchmark(event.target.value)}
                    >
                        <option value={OWN_FINAL}>its own final design</option>
                        <EntrantOptions ships={props.ships} fleets={props.fleets} label={(_, name) => name} />
                    </select>
                </Field>
                <Buttons>
                    <Button id="measure" disabled={!props.canMeasure} onClick={props.onMeasure}>
                        Measure
                    </Button>
                    <Button
                        id="watchYardstick"
                        disabled={!props.hasChampion || props.inRounds}
                        title="Watch the picked design of the generation on show, or its best, fight the opponent as the measurement does"
                        onClick={props.onWatchYardstick}
                    >
                        Watch
                    </Button>
                </Buttons>
                <Note id="yardstickLine">{props.yardstickLine}</Note>
                {grid !== null && (
                    <Grid id="grid">
                        <tbody>
                            <tr>
                                <th>A↓ B→</th>
                                {grid.columns.map((point, c) => (
                                    <th key={c} title={gridLabel(point)} style={{ color: teamColour(1) }}>
                                        {short(point)}
                                    </th>
                                ))}
                            </tr>
                            {grid.rows.map((point, r) => (
                                <tr key={r}>
                                    <th title={gridLabel(point)} style={{ color: teamColour(0) }}>
                                        {short(point)}
                                    </th>
                                    {grid.columns.map((column, c) => {
                                        const cell = grid.cells[r]?.[c];
                                        if (cell === undefined) return <td key={c} />;
                                        const share = most > 0 ? Math.round((Math.abs(cell.margin) / most) * 60) : 0;
                                        return (
                                            <td
                                                key={c}
                                                title={
                                                    `A's champion of ${gridLabel(point)} against B's of ${gridLabel(column)}: ` +
                                                    `won ${cell.wins} of ${grid.seeds}, by ${cell.margin >= 0 ? "+" : ""}${cell.margin.toFixed(3)} on average`
                                                }
                                                style={{
                                                    background: `color-mix(in srgb, ${teamColour(cell.margin >= 0 ? 0 : 1)} ${share}%, transparent)`,
                                                }}
                                            >
                                                {`${cell.wins}/${grid.seeds}`}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </Grid>
                )}
            </Fold>
        </Panel>
    );
}
