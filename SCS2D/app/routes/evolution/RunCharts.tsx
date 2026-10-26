import { styled } from "@linaria/react";
import { useEffect, useRef, useState } from "react";
import { drawChart, indexAt, xOf, type ChartLayout, type Series } from "~/render/chart";
import { DOCTRINE_NUMBERS } from "~/evolution/run";

const NO_LAYOUT: ChartLayout = { x: 0, y: 0, width: 0, height: 0, count: 0 };

const Wrap = styled.div`
    position: relative;

    canvas {
        display: block;
        width: 100%;
        border-radius: 4px;
        cursor: crosshair;
    }
`;

const Tip = styled.span`
    position: absolute;
    top: 100%;
    z-index: 1;
    margin-top: 1px;
    padding: 0 0.35rem;
    border: 1px solid var(--colour-control-border);
    border-radius: 3px;
    background: var(--colour-surface);
    color: var(--colour-text);
    white-space: nowrap;
    pointer-events: none;
    transform: translateX(-50%);
`;

const Key = styled.p`
    display: flex;
    flex-wrap: wrap;
    gap: 0.8rem;
    margin: 0.35rem 0 0;
    color: var(--colour-muted);

    span::before {
        display: inline-block;
        width: 10px;
        height: 2px;
        margin-right: 0.35rem;
        background: currentcolor;
        content: "";
        vertical-align: middle;
    }

    b {
        margin-left: 0.25rem;
        color: var(--colour-heading);
        font-weight: 600;
    }
`;

const Metric = styled.label`
    display: block;
    margin-top: 0.5rem;
    color: #8a9bb0;
    font-size: 0.8rem;
`;

interface ChartProps {
    readonly id: string;
    readonly series: readonly Series[];
    readonly height: number;
    readonly hover: number | null;
    readonly picked: number | undefined;
    readonly onHover: (at: number | null) => void;
    readonly onSeek: (at: number) => void;
    /** What the generation under the pointer is called, under the chart beneath it, if this chart says. */
    readonly tip?: (at: number) => string;
}

/**
 * A chart of the run, a point a generation: what is under the pointer is
 * marked, and holding the pointer down seeks through the generations, past
 * either end of the plot to the end of the run.
 */
function Chart({ id, series, height, hover, picked, onHover, onSeek, tip }: ChartProps) {
    const canvas = useRef<HTMLCanvasElement>(null);
    const layout = useRef(NO_LAYOUT);
    const tipBox = useRef<HTMLSpanElement>(null);
    const seeking = useRef(false);
    const [, resized] = useState(0);

    useEffect(() => {
        const at = canvas.current!;
        const observer = new ResizeObserver(() => {
            const ratio = window.devicePixelRatio || 1;
            const rect = at.getBoundingClientRect();
            at.width = Math.round(rect.width * ratio);
            at.height = Math.round(rect.height * ratio);
            resized((n) => n + 1);
        });
        observer.observe(at);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        const at = canvas.current!;
        const ctx = at.getContext("2d");
        if (ctx === null) return;
        layout.current = drawChart(ctx, series, at.width, at.height, window.devicePixelRatio || 1, {
            hover: hover ?? undefined,
            picked,
        });
        if (tipBox.current !== null && hover !== null) tipBox.current.style.left = `${xOf(layout.current, hover)}px`;
    });

    const pointAt = (event: React.PointerEvent<HTMLCanvasElement>, clamp: boolean): number | null =>
        indexAt(layout.current, event.clientX - event.currentTarget.getBoundingClientRect().left, clamp);
    const stop = (event: React.PointerEvent<HTMLCanvasElement>): void => {
        if (!seeking.current) return;
        seeking.current = false;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    };

    return (
        <Wrap>
            <canvas
                ref={canvas}
                id={id}
                style={{ height }}
                onPointerMove={(event) => {
                    const at = pointAt(event, seeking.current);
                    onHover(at);
                    if (seeking.current && at !== null) onSeek(at);
                }}
                onPointerLeave={() => {
                    if (!seeking.current) onHover(null);
                }}
                onPointerDown={(event) => {
                    const at = pointAt(event, true);
                    if (at === null) return;
                    // Captured, so a drag off the end of the plot goes on seeking rather than stopping where the canvas does.
                    event.currentTarget.setPointerCapture(event.pointerId);
                    seeking.current = true;
                    onSeek(at);
                }}
                onPointerUp={stop}
                onPointerCancel={stop}
            />
            {tip !== undefined && (
                <Tip ref={tipBox} id={`${id}Tip`} hidden={hover === null}>
                    {hover === null ? "" : tip(hover)}
                </Tip>
            )}
        </Wrap>
    );
}

interface LegendProps {
    readonly id: string;
    readonly series: readonly Series[];
    readonly hover: number | null;
    readonly digits: number;
    readonly unit: string;
    readonly rightDigits?: number;
    readonly rightUnit?: string;
}

/**
 * The names of the lines and, while a generation is under the pointer, what
 * each was worth there: on the legend rather than in the tooltip, because the
 * colours are already here.
 */
function Legend({ id, series, hover, digits, unit, rightDigits = digits, rightUnit = unit }: LegendProps) {
    return (
        <Key id={id}>
            {series.map((line) => {
                const value = hover === null ? undefined : line.values[hover];
                return (
                    <span key={line.name} style={{ color: line.colour }}>
                        {line.name}
                        {value !== undefined && Number.isFinite(value) && (
                            <b>{line.right === true ? value.toFixed(rightDigits) + rightUnit : value.toFixed(digits) + unit}</b>
                        )}
                    </span>
                );
            })}
        </Key>
    );
}

/** The score's lines before there is anything to plot, so the key reads before the run does. */
const SCORE_KEY: readonly Series[] = [
    { name: "best", colour: "#e6edf5", values: [] },
    { name: "mean", colour: "#7fa8e0", values: [] },
    { name: "hull kept", colour: "#7fd6a0", values: [] },
    { name: "function kept", colour: "#b48ee0", values: [] },
    { name: "damage", colour: "#e0655f", values: [] },
    { name: "function taken", colour: "#e08ec0", values: [] },
    { name: "ground", colour: "#e9c05f", values: [] },
    { name: "vs. yardstick", colour: "#5bd6d6", values: [] },
];

export interface RunChartsProps {
    readonly score: readonly Series[];
    /** Whether the score is worth a chart: against a side that moves too, it says nothing over time. */
    readonly showScore: boolean;
    readonly size: readonly Series[];
    readonly metric: string;
    readonly onMetric: (metric: string) => void;
    /** Each doctrine number's option, labelled with how far its mean has moved. */
    readonly doctrineLabel: (key: string) => string;
    readonly sizeKey: { digits: number; unit: string; rightDigits: number; rightUnit: string };
    readonly picked: number | undefined;
    readonly label: (at: number) => string;
    readonly onSeek: (at: number) => void;
}

/** The run's score over its generations, and under it how big its designs were, or how far apart their scores, or a doctrine number. */
export function RunCharts({ score, showScore, size, metric, onMetric, doctrineLabel, sizeKey, picked, label, onSeek }: RunChartsProps) {
    const [hover, setHover] = useState<number | null>(null);
    return (
        <>
            {showScore && (
                <>
                    <Chart
                        id="chart"
                        series={score}
                        height={170}
                        hover={hover}
                        picked={picked}
                        onHover={setHover}
                        onSeek={onSeek}
                        tip={label}
                    />
                    <Legend id="legend" series={score.length > 0 ? score : SCORE_KEY} hover={hover} digits={3} unit="" />
                </>
            )}
            <Metric>
                chart{" "}
                <select
                    id="sizeMetric"
                    value={metric}
                    onChange={(event) => onMetric(event.target.value)}
                    title="How far apart the scores are: the middle half and best to worst on the left, how many tied on the right. Narrow, or many tied, and selection can hardly tell the designs apart."
                >
                    <option value="mass">size: mass and ships</option>
                    <option value="fittings">size: weapons and engines</option>
                    <option value="spread">how far apart the scores are</option>
                    <optgroup label="doctrine, and how far its mean has moved">
                        {DOCTRINE_NUMBERS.map((key) => (
                            <option key={key} value={`doctrine:${key}`}>
                                {doctrineLabel(key)}
                            </option>
                        ))}
                    </optgroup>
                </select>
            </Metric>
            <Chart id="massChart" series={size} height={100} hover={hover} picked={picked} onHover={setHover} onSeek={onSeek} />
            <Legend id="massLegend" series={size} hover={hover} {...sizeKey} />
        </>
    );
}
