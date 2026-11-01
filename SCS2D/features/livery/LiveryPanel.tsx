import { styled } from "@linaria/react";
import { NEW_LIVERY } from "~/editor/livery";
import { teamName, sidesOf } from "~/render/teams";
import { LIVERY_PATTERNS, type Livery, type LiveryPattern } from "~/sim/index";
import { Button } from "~/ui/buttons/Button";

const Details = styled.details`
    margin-top: 0.7rem;
    padding-top: 0.6rem;
    border-top: 1px solid var(--colour-border);

    summary {
        color: var(--colour-muted);
        cursor: pointer;
    }

    summary:hover {
        color: var(--colour-text);
    }

    summary span {
        color: var(--colour-heading);
    }

    p {
        margin: 0.5rem 0 0;
        color: var(--colour-faint);
    }
`;

const Row = styled.div`
    display: flex;
    gap: 0.4rem;
    align-items: center;
    margin-top: 0.3rem;

    > label {
        flex: 0 0 6.5rem;
        color: var(--colour-muted);
    }

    > input,
    > select {
        flex: 1;
        min-width: 0;
    }

    > output {
        flex: 0 0 3rem;
        color: var(--colour-faint);
        text-align: right;
    }
`;

const Swatch = styled.span`
    display: inline-block;
    width: 0.8em;
    height: 0.8em;
    margin-right: 0.3em;
    border-radius: 2px;
    vertical-align: -0.05em;
`;

const PATTERN_NAMES: Record<LiveryPattern, string> = { none: "plain", stripes: "stripes", spots: "spots" };

/** A slider's range and how its value reads. */
interface Slider {
    readonly field: "size" | "spacing" | "offset" | "angle";
    readonly label: string;
    readonly min: number;
    readonly max: number;
    readonly step: number;
    readonly title: string;
    readonly shown: (livery: Livery) => string;
}

const DEGREES = 180 / Math.PI;

const SLIDERS: readonly Slider[] = [
    {
        field: "size",
        label: "size",
        min: 0.02,
        max: 0.5,
        step: 0.01,
        title: "How wide a stripe or spot is, as a share of each ship's radius",
        shown: (l) => `${Math.round(l.size * 100)}%`,
    },
    {
        field: "spacing",
        label: "spacing",
        min: 0.05,
        max: 1,
        step: 0.01,
        title: "From one stripe or spot to the next, as a share of each ship's radius",
        shown: (l) => `${Math.round(l.spacing * 100)}%`,
    },
    {
        field: "offset",
        label: "offset",
        min: 0,
        max: 1,
        step: 0.01,
        title: "How far the pattern is moved across the hull, as a share of its spacing",
        shown: (l) => `${Math.round(l.offset * 100)}%`,
    },
    {
        field: "angle",
        label: "angle",
        min: -90,
        max: 90,
        step: 1,
        title: "Which way the stripes run across the design",
        shown: (l) => `${Math.round(l.angle * DEGREES)}°`,
    },
];

export interface LiveryPanelProps {
    readonly livery: Livery | undefined;
    /** Whose it is, as the summary says: "the fleet's" or "this ship's". */
    readonly whose: string;
    /** Said under the boxes: what the livery is worn on. */
    readonly note: string;
    readonly open: boolean;
    onOpen(open: boolean): void;
    /** A new livery, or none for side colours; `continues` while a slider or colour is still being dragged. */
    onChange(next: Livery | undefined, continues: boolean): void;
    /** The drag is over; the next change is an undo step of its own. */
    onEnd(): void;
}

/**
 * How a fleet or a lone ship is painted: shut by default, its summary the
 * colour it is drawn in. Left unset, it is drawn in side colours.
 */
export function LiveryPanel({ livery, whose, note, open, onOpen, onChange, onEnd }: LiveryPanelProps) {
    const set = (change: Partial<Livery>, continues: boolean): void => {
        if (livery !== undefined) onChange({ ...livery, ...change }, continues);
    };
    return (
        <Details id="livery" open={open} onToggle={(event) => onOpen(event.currentTarget.open)}>
            <summary>
                Livery — {whose}{" "}
                <span id="liverySummary">
                    {livery === undefined ? (
                        "side colours"
                    ) : (
                        <>
                            <Swatch style={{ background: livery.base }} />
                            {teamName(0, sidesOf([livery])).toLowerCase()}
                            {livery.pattern === "none" ? "" : `, ${PATTERN_NAMES[livery.pattern]}`}
                        </>
                    )}
                </span>
            </summary>
            {livery === undefined ? (
                <Button id="liverySet" title="Paint it in colours of its own" onClick={() => onChange(NEW_LIVERY, false)}>
                    Set a livery
                </Button>
            ) : (
                <div id="liveryFields" onPointerUp={onEnd} onKeyUp={onEnd} onBlur={onEnd}>
                    <Row>
                        <label htmlFor="liveryBase">base</label>
                        <input
                            id="liveryBase"
                            type="color"
                            title="The colour the hull is painted"
                            value={livery.base}
                            onInput={(event) => set({ base: event.currentTarget.value }, true)}
                            onChange={(event) => set({ base: event.currentTarget.value }, true)}
                        />
                    </Row>
                    <Row>
                        <label htmlFor="liveryHighlight">highlight</label>
                        <input
                            id="liveryHighlight"
                            type="color"
                            title="The colour of the pattern, and of the parts picked out in it"
                            value={livery.highlight}
                            onInput={(event) => set({ highlight: event.currentTarget.value }, true)}
                            onChange={(event) => set({ highlight: event.currentTarget.value }, true)}
                        />
                    </Row>
                    <Row>
                        <label htmlFor="liveryPattern">pattern</label>
                        <select
                            id="liveryPattern"
                            value={livery.pattern}
                            onChange={(event) => set({ pattern: event.currentTarget.value as LiveryPattern }, false)}
                        >
                            {LIVERY_PATTERNS.map((pattern) => (
                                <option key={pattern} value={pattern}>
                                    {PATTERN_NAMES[pattern]}
                                </option>
                            ))}
                        </select>
                    </Row>
                    {livery.pattern !== "none" &&
                        SLIDERS.filter((slider) => slider.field !== "angle" || livery.pattern === "stripes").map((slider) => {
                            const value = slider.field === "angle" ? livery.angle * DEGREES : livery[slider.field];
                            const id = `livery${slider.field[0]!.toUpperCase()}${slider.field.slice(1)}`;
                            return (
                                <Row key={slider.field}>
                                    <label htmlFor={id}>{slider.label}</label>
                                    <input
                                        id={id}
                                        type="range"
                                        title={slider.title}
                                        min={slider.min}
                                        max={slider.max}
                                        step={slider.step}
                                        value={value}
                                        onChange={(event) => {
                                            const typed = Number(event.currentTarget.value);
                                            set({ [slider.field]: slider.field === "angle" ? typed / DEGREES : typed }, true);
                                        }}
                                    />
                                    <output htmlFor={id}>{slider.shown(livery)}</output>
                                </Row>
                            );
                        })}
                    <p>{note}</p>
                    <Button id="liveryClear" title="Paint it in its side's colours again" onClick={() => onChange(undefined, false)}>
                        Side colours
                    </Button>
                </div>
            )}
        </Details>
    );
}
