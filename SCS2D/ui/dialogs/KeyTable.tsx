import { styled } from "@linaria/react";

const Table = styled.table`
    width: 100%;
    border-collapse: collapse;

    td {
        padding: 0.2rem 0;
        border-top: 1px solid var(--colour-border);
        vertical-align: top;
    }

    td:first-child {
        padding-right: 1.2rem;
        color: var(--colour-heading);
        white-space: nowrap;
    }
`;

const Note = styled.p`
    margin: 0.7rem 0 0;
    color: var(--colour-muted);
`;

/** One row of the table: what to press, and what it does. */
export interface KeyRow {
    readonly keys: string;
    readonly does: string;
}

export interface KeyTableProps {
    readonly rows: readonly KeyRow[];
    readonly notes?: readonly string[];
}

/** A page's keys and mouse: what to press, and what it does. */
export function KeyTable({ rows, notes = [] }: KeyTableProps) {
    return (
        <>
            <Table>
                <tbody>
                    {rows.map((row) => (
                        <tr key={row.keys}>
                            <td>{row.keys}</td>
                            <td>{row.does}</td>
                        </tr>
                    ))}
                </tbody>
            </Table>
            {notes.map((note) => (
                <Note key={note}>{note}</Note>
            ))}
        </>
    );
}
