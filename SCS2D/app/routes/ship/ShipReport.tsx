import { styled } from "@linaria/react";
import type { EditorDocument } from "~/editor/document";
import { attackBearings, doctrineBand } from "~/editor/preview";
import { buildTime, designStats, megajoules, megawatts, type Envelopes } from "~/editor/stats";
import { inReachDesign, radiansToDegrees } from "~/sim/index";
import { controlReadout, numbers, reachWarnings } from "./shipFields";

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
    color: var(--colour-faint);

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

/** What the ship works out to: its mass, cost, endurance, power, handling and how it means to fight. */
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
    const band = doctrineBand(design);
    const rows: [string, string][] = [
        ["Mass", `${numbers(s.mass / 1000, 2)} t, ${numbers(s.fuel / 1000, 2)} t of it fuel and ${numbers(s.metal / 1000, 2)} t metal`],
        [
            "Cost",
            `${numbers(s.bill.metal / 1000, 2)} t of metal, ${numbers(s.bill.fuel / 1000, 2)} t of fuel and ${buildTime(s.bill.build)} for one robot to build` +
                ((design.aboard?.length ?? 0) > 0 ? ", with the fighters it sets out with" : ""),
        ],
        [
            "Endurance",
            Number.isFinite(s.endurance) ? `${numbers(s.endurance, 0)} s flat out, ${numbers(s.deltaV, 0)} m/s of Δv` : "no engines",
        ],
        [
            "Power",
            s.generation > 0 || s.storage > 0
                ? `${megawatts(s.generation)} generated, ${megajoules(s.storageAtStart)} stored` +
                  (s.storageAtStart < s.storage ? ` of ${megajoules(s.storage)}` : "") +
                  (s.discharge > 0 ? `, given out at up to ${megawatts(s.discharge)}` : "") +
                  (s.beamDraw > 0 ? `; its beams draw ${megawatts(s.beamDraw)} firing flat out` : "")
                : "no generators or batteries",
        ],
        [
            "Ammunition",
            s.mainRounds === null
                ? "no guns that fire rounds"
                : `${numbers(s.mainRounds.rounds, 0)} rounds of its ${numbers(s.mainRounds.roundMass, 1)} kg main gun`,
        ],
        ["Inertia", `${numbers(s.inertia / 1000, 0)} t·m²`],
        ["Modules", `${s.moduleCount} (${s.engineCount} engines)`],
        ["Control", controlReadout(design)],
        ["Radius", `${numbers(s.radius)} m`],
        ["Accel fore / aft", `${numbers(s.accelFore, 2)} / ${numbers(s.accelAft, 2)} m/s²`],
        ["Accel port / stbd", `${numbers(s.accelPort, 2)} / ${numbers(s.accelStarboard, 2)} m/s²`],
        ["Turn left / right", `${numbers(radiansToDegrees(s.turnLeft), 2)} / ${numbers(radiansToDegrees(s.turnRight), 2)} °/s²`],
        ["Authority", s.fullAuthority ? "full" : "incomplete — cannot hold a heading"],
        // What a layout pays for its thrust not being balanced about its centre
        // of mass: the acceleration it gives up to avoid spinning. The envelope
        // shows which directions it is paid in.
        ["Heading cost", s.headingCost < 0.005 ? "none — thrust is balanced" : `up to ${numbers(s.headingCost * 100)}%`],
        // No turret rows: a gun's figures belong to the gun, and selecting it shows them.
        ["Turrets", `${s.turrets.length}`],
        // Against the enemy its own doctrine wants, as the band drawn round it is.
        ["Closes to", `${numbers(band.min, 0)}–${numbers(band.max, 0)} m, centre to centre`],
        // Positive is to port, as every bearing in the body frame is.
        [
            "Fights with target at",
            attackBearings(design)
                .map((r) => `${numbers(radiansToDegrees(r.bearing), 0)}° (${r.guns} of ${r.total} main guns)`)
                .join(", "),
        ],
    ];
    return (
        <div id="stats">
            <Figures>
                <tbody>
                    {rows.map(([name, value]) => (
                        <tr key={name}>
                            <th>{name}</th>
                            <td>{value}</td>
                        </tr>
                    ))}
                </tbody>
            </Figures>
        </div>
    );
}

/** What is wrong with the layout, listed rather than refused; what flies but does nothing; and what a file carried that nothing reads. */
export function ShipProblems({ doc }: { readonly doc: EditorDocument }) {
    const { problems, warnings, design } = doc.view;
    const reach = reachWarnings(design);
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
