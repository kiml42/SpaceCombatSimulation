import { styled } from "@linaria/react";
import type { EditorDocument } from "~/editor/document";
import { buildTime, designStats, megajoules, megawatts, type Envelopes } from "~/editor/stats";
import { inReachDesign, moduleOutline, radiansToDegrees, type ShipDesign } from "~/sim/index";
import { numbers, reachWarnings } from "./shipFields";

export const Figures = styled.table`
    width: 100%;
    border-collapse: collapse;

    th {
        padding: 0.1rem 0.6rem 0.1rem 0;
        color: var(--colour-muted);
        font-weight: 400;
        text-align: left;
        vertical-align: top;
    }

    td {
        padding: 0.1rem 0;
        color: var(--colour-heading);
        text-align: right;
    }

    /* A part of the row above: its fuel and metal under the mass. */
    tr.sub th {
        padding-left: 1rem;
    }
`;

const Ok = styled.p`
    margin: 0;
    color: var(--colour-ok);
`;

const Warn = styled.div`
    margin: 0;
    color: var(--colour-warning);

    p {
        margin: 0;
    }

    ul {
        margin: 0.3rem 0 0;
        padding-left: 1.1rem;
    }

    li {
        margin-bottom: 0.2rem;
        overflow-wrap: anywhere;
    }
`;

const Note = styled.div`
    color: var(--colour-muted);

    p {
        margin: 0.4rem 0 0;
    }

    ul {
        margin: 0.3rem 0 0;
        padding-left: 1.1rem;
    }
`;

const None = styled.p`
    margin: 0;
    color: var(--colour-muted);
`;

/** Above this share of its push given up to stop it spinning, a layout's balance is worth a warning. */
const HEADING_COST_WARNING = 0.25;

/** How long and wide the hull is along its bow and across it, metres. */
function extent(design: ShipDesign): { length: number; width: number } {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const corners: number[] = [];
    for (const module of design.modules) {
        const count = moduleOutline(module.spec, corners);
        for (let k = 0; k < count * 2; k += 2) {
            minX = Math.min(minX, corners[k]!);
            maxX = Math.max(maxX, corners[k]!);
            minY = Math.min(minY, corners[k + 1]!);
            maxY = Math.max(maxY, corners[k + 1]!);
        }
    }
    return maxX >= minX ? { length: maxX - minX, width: maxY - minY } : { length: 0, width: 0 };
}

type Row = readonly [name: string, value: string, sub?: boolean];

function Rows({ rows }: { readonly rows: readonly Row[] }) {
    return (
        <Figures>
            <tbody>
                {rows.map(([name, value, sub]) => (
                    <tr key={name} className={sub === true ? "sub" : undefined}>
                        <th>{name}</th>
                        <td>{value}</td>
                    </tr>
                ))}
            </tbody>
        </Figures>
    );
}

/** The ship's figures, short enough to keep each on one line. */
const Stats = styled.div`
    th,
    td {
        white-space: nowrap;
    }
`;

const More = styled.details`
    margin-top: 0.4rem;

    > summary {
        color: var(--colour-muted);
        cursor: pointer;
    }
`;

/** What the ship works out to, the figures a design is judged by first and the rest folded away. */
export function ShipStats({ doc, envelope }: { readonly doc: EditorDocument; readonly envelope: Envelopes | null }) {
    const design = doc.view.design;
    if (design === null || envelope === null) {
        return (
            <div id="stats">
                <None>{doc.view.underivable ?? "Nothing to measure yet."}</None>
            </div>
        );
    }
    const s = designStats(inReachDesign(design), envelope);
    const size = extent(design);
    const turn = (rate: number): string => numbers(radiansToDegrees(rate), 1);
    const main: Row[] = [
        ["Mass", `${numbers(s.mass / 1000, 1)} t`],
        ["fuel", `${numbers(s.fuel / 1000, 1)} t`, true],
        ["hold metal", `${numbers(s.metal / 1000, 1)} t`, true],
        ["Build", buildTime(s.bill.build)],
        ["Burn", Number.isFinite(s.endurance) ? `${numbers(s.endurance, 0)} s` : "no engines"],
        ["Δv", `${(s.deltaV / 1000).toFixed(1)} km/s`],
        ["Rounds", s.mainRounds === null ? "none" : `${numbers(s.mainRounds.rounds, 0)} × ${numbers(s.mainRounds.roundMass, 1)} kg`],
        ["Power", megawatts(s.generation)],
        ["Stored", megajoules(s.storageAtStart)],
        ["Turn L / R", `${turn(s.turnLeft)} / ${turn(s.turnRight)} °/s²`],
    ];
    const more: Row[] = [
        ["Inertia", `${numbers(s.inertia / 1000, 0)} t·m²`],
        ["Modules", `${s.moduleCount}`],
        ["engines", `${s.engineCount}`, true],
        ["weapons", `${s.turrets.length}`, true],
        ["Size L × W", `${numbers(size.length, 1)} × ${numbers(size.width, 1)} m`],
        ["Radius", `${numbers(s.radius, 1)} m`],
        ["Accel F / A", `${numbers(s.accelFore, 2)} / ${numbers(s.accelAft, 2)} m/s²`],
        ["Accel P / S", `${numbers(s.accelPort, 2)} / ${numbers(s.accelStarboard, 2)} m/s²`],
    ];
    return (
        <Stats id="stats">
            <Rows rows={main} />
            <More id="moreStats">
                <summary>More</summary>
                <Rows rows={more} />
            </More>
        </Stats>
    );
}

/** What flies but flies badly: no way to hold a heading, or a balance that costs much of its push. */
function handlingWarnings(design: ShipDesign | null, envelope: Envelopes | null): string[] {
    if (design === null || envelope === null) return [];
    const s = designStats(inReachDesign(design), envelope);
    const out: string[] = [];
    if (!s.fullAuthority) out.push("its engines cannot push and turn it every way, so it cannot hold a heading while it moves");
    if (s.headingCost > HEADING_COST_WARNING) {
        out.push(
            `its thrust is off its centre of mass: pushing some ways it gives up to ${numbers(s.headingCost * 100, 0)}% of its push to stop itself spinning`,
        );
    }
    return out;
}

/** What is wrong with the layout, listed rather than refused; what flies but does nothing; and what a file carried that nothing reads. */
export function ShipProblems({ doc, envelope }: { readonly doc: EditorDocument; readonly envelope: Envelopes | null }) {
    const { problems, warnings, design } = doc.view;
    const reach = [...reachWarnings(design), ...handlingWarnings(design, envelope)];
    return (
        <div id="problems">
            {problems.length === 0 ? (
                <Ok>No problems — this layout would fly.</Ok>
            ) : (
                <Warn>
                    <p>{`${problems.length} problem${problems.length > 1 ? "s" : ""}`}</p>
                    <ul>
                        {problems.map((problem) => (
                            <li key={problem}>{problem}</li>
                        ))}
                    </ul>
                </Warn>
            )}
            {reach.length > 0 && (
                <Note>
                    <p>{`${reach.length} warning${reach.length > 1 ? "s" : ""}`}</p>
                    <ul>
                        {reach.map((warning) => (
                            <li key={warning}>{warning}</li>
                        ))}
                    </ul>
                </Note>
            )}
            {warnings.length > 0 && (
                <Note>
                    <p>Kept as written, and saved and exported with the ship:</p>
                    <ul>
                        {warnings.map((warning) => (
                            <li key={warning}>{warning}</li>
                        ))}
                    </ul>
                </Note>
            )}
        </div>
    );
}

/** A ship already built to the design as it was opened, refitted to this one: what is built and taken down. */
export function ShipRefit({ doc }: { readonly doc: EditorDocument }) {
    const refit = doc.refit;
    if (refit === null) return null;
    return (
        <section id="refitSection">
            <h2>Refit</h2>
            <div id="refit">
                <p>{`A ship built as it was opened, refitted to this: ${refit.built.length} built (green), ${refit.takenDown.length} taken down (dashed).`}</p>
                {refit.refused !== null ? (
                    <Warn>
                        <p>{`It could not be refitted: ${refit.refused}.`}</p>
                    </Warn>
                ) : (
                    !refit.bay && (
                        <Warn>
                            <p>It has no robot bay, so a refit to it could never be finished.</p>
                        </Warn>
                    )
                )}
            </div>
        </section>
    );
}
