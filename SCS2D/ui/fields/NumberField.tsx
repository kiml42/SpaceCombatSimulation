import { styled } from "@linaria/react";
import { useId } from "react";

const Row = styled.div`
    display: grid;
    grid-template-columns: 7.5rem 1fr auto 1fr;
    gap: 0.3rem;
    align-items: center;
    margin-bottom: 0.25rem;

    label {
        color: var(--colour-muted);
    }

    input {
        width: 100%;
        min-width: 0;
        padding: 0.15rem 0.3rem;
        border: 1px solid var(--colour-control-border);
        border-radius: 3px;
        background: var(--colour-background);
        color: var(--colour-text);
    }

    /* Alone, it takes the whole width the box and its ± share on a row that has one, so the two line up. */
    input:only-of-type {
        grid-column: 2 / -1;
    }

    span {
        color: var(--colour-faint);
    }
`;

export interface Spread {
    readonly value: string;
    readonly onChange: (value: string) => void;
    readonly title: string;
}

export interface NumberFieldProps {
    readonly label: string;
    /** What the setting means, shown on hover. */
    readonly title: string;
    /** The box's text, kept as typed so it can be empty or half finished. */
    readonly value: string;
    readonly onChange: (value: string) => void;
    readonly step: number;
    /** 0 unless said; null for no least. */
    readonly min?: number | null;
    readonly max?: number;
    /** A second box after a ±: how far either side the setting may be drawn. */
    readonly spread?: Spread;
}

/** One setting on a settings card: its name, its box, and the ± of it where it has one. */
export function NumberField({ label, title, value, onChange, step, min = 0, max, spread }: NumberFieldProps) {
    const id = useId();
    return (
        <Row title={title}>
            <label htmlFor={id}>{label}</label>
            <input
                id={id}
                type="number"
                value={value}
                step={step}
                min={min ?? undefined}
                max={max}
                onChange={(event) => onChange(event.target.value)}
            />
            {spread !== undefined && (
                <>
                    <span aria-hidden="true">±</span>
                    <input
                        type="number"
                        aria-label={`${label} either side`}
                        title={spread.title}
                        value={spread.value}
                        step={step}
                        min={0}
                        onChange={(event) => spread.onChange(event.target.value)}
                    />
                </>
            )}
        </Row>
    );
}
