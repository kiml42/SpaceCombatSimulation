import { styled } from "@linaria/react";
import { kg } from "~/editor/budget";
import type { FleetView } from "~/editor/fleetDocument";
import { buildTime } from "~/editor/stats";

const Table = styled.table`
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

const Designs = styled(Table)`
    th {
        color: var(--colour-heading);
        overflow-wrap: anywhere;
    }

    td {
        padding-left: 0.6rem;
        color: var(--colour-muted);
        white-space: nowrap;
    }
`;

const Listed = styled.ul`
    margin: 0.3rem 0 0;
    padding-left: 1.1rem;

    li {
        margin-bottom: 0.2rem;
        color: var(--colour-warning);
        overflow-wrap: anywhere;
    }
`;

const Ok = styled.p`
    margin: 0;
    color: var(--colour-ok);
`;

const Note = styled.div`
    color: var(--colour-faint);

    p {
        margin: 0.4rem 0 0;
    }
`;

/** Every design the fleet carries, flown or not, each with a link to change it in the ship editor. */
export function DesignList({
    view,
    designHref,
    onLeave,
}: {
    readonly view: FleetView;
    readonly designHref: (design: string) => string;
    readonly onLeave: () => void;
}) {
    return (
        <Designs id="designList">
            <tbody>
                {view.roster.length === 0 ? (
                    <tr>
                        <td>None yet.</td>
                    </tr>
                ) : (
                    view.roster.map((line) => (
                        <tr key={line.name}>
                            <th>{line.name}</th>
                            <td title="Ships of it at the start, and how many more of it the fleet's pads and slipways build">
                                {`${line.start} at start${line.builds > 0 ? `, builds ${line.builds}` : ""}`}
                            </td>
                            <td>
                                <a
                                    href={designHref(line.name)}
                                    data-design={line.name}
                                    title="Open this design in the ship editor, and come back to the fleet with it changed"
                                    onClick={onLeave}
                                >
                                    Edit
                                </a>
                            </td>
                        </tr>
                    ))
                )}
            </tbody>
        </Designs>
    );
}

/** What the fleet works out to: its ships, its mass, its cost, and each design's share. */
export function FleetStats({ view }: { readonly view: FleetView }) {
    return (
        <Table id="stats">
            <tbody>
                <tr>
                    <th>ships</th>
                    <td>{view.ships.length}</td>
                </tr>
                <tr>
                    <th>mass at launch</th>
                    <td>{kg(view.mass)}</td>
                </tr>
                <tr>
                    <th>cost</th>
                    <td>{`${kg(view.bill.metal)} metal, ${kg(view.bill.fuel)} fuel, ${buildTime(view.bill.build)} to build`}</td>
                </tr>
                {view.lines.map((line) => (
                    <tr key={line.name}>
                        <th>{line.name}</th>
                        <td>{`${line.count} × ${kg(line.mass)}`}</td>
                    </tr>
                ))}
            </tbody>
        </Table>
    );
}

/** What is wrong with it, listed rather than refused, with a way to update a design that differs from the library's. */
export function FleetProblems({ view, onUpdate }: { readonly view: FleetView; readonly onUpdate: (design: string) => void }) {
    const note =
        view.warnings.length === 0 ? null : (
            <Note>
                <p>Kept as written, and saved and exported with the fleet:</p>
                <ul>
                    {view.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                    ))}
                </ul>
            </Note>
        );
    return (
        <div id="problems">
            {view.problems.length === 0 ? (
                <Ok>None.</Ok>
            ) : (
                <Listed>
                    {view.problems.map((problem) => (
                        <li key={problem}>{problem}</li>
                    ))}
                </Listed>
            )}
            {note}
            {view.problems.length > 0 &&
                view.stale.map((name) => (
                    <p key={name}>
                        <button data-refresh={name} title="Replace this fleet's copy with the library's" onClick={() => onUpdate(name)}>
                            {`Update ${name}`}
                        </button>
                    </p>
                ))}
        </div>
    );
}
