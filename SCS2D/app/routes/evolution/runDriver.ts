import type { Entrant } from "~/evolution/match";
import { GridMeasure, Yardstick, type ChampionGrid, type YardstickReport } from "~/evolution/yardstick";
import type { AnyRun } from "./runView";

/**
 * A run and its measurements, stepped on the page's clock in slices a few
 * milliseconds long between frames, rather than on a thread of their own: the
 * point of the page is to see what a run is doing while it does it, so what
 * is drawn is the match the run is actually fighting.
 *
 * Mutable, and read by the page at each sample rather than held in React
 * state (DESIGN.md non-negotiable 5).
 */
export class RunDriver {
    run: AnyRun | null = null;
    paused = false;
    yardstick: Yardstick | null = null;
    measured: YardstickReport | null = null;
    /**
     * Every measurement of this run so far, by the opponent's file text, so
     * measuring against the same opponent again carries on from what was found
     * rather than fighting every generation over again.
     */
    private readonly measurements = new Map<string, YardstickReport>();
    private measuringAgainst = "";
    /** A co-evolution run's champion grid, being fought or fought. */
    grid: GridMeasure | null = null;
    gridResult: ChampionGrid | null = null;

    /** Put a run on show from its start, forgetting everything about the last. */
    begin(run: AnyRun): void {
        this.run = run;
        this.paused = false;
        this.yardstick = null;
        this.measured = null;
        this.measurements.clear();
        this.grid = null;
        this.gridResult = null;
    }

    setPaused(paused: boolean): void {
        this.paused = paused;
    }

    /** Whether there is a measurement being fought. */
    get measuring(): boolean {
        return this.yardstick !== null || this.grid !== null;
    }

    /** The yardstick's points, being measured or measured. */
    get points(): YardstickReport["points"] | undefined {
        return this.yardstick?.points ?? this.measured?.points;
    }

    /** Start measuring every generation against `benchmark`, carrying on from where it was last measured against it. */
    measure(benchmark: Entrant, text: string): YardstickReport | undefined {
        if (this.run === null) return undefined;
        // The record rather than a copy of it, so a measurement started while a
        // run is still going carries on into the generations it has not closed yet.
        this.measuringAgainst = text;
        const before = this.measurements.get(text);
        this.yardstick = new Yardstick(this.run.record(), benchmark, undefined, before);
        this.measured = null;
        return before;
    }

    /** Start fighting each side's champions against the other's. */
    measureGrid(): void {
        if (this.run === null) return;
        this.grid = new GridMeasure(this.run.record());
        this.gridResult = null;
    }

    /** Spend up to `budget` ms on each of the run and whatever is being measured. */
    work(budget: number): void {
        const run = this.run;
        if (run !== null && !run.done && !this.paused) {
            const until = performance.now() + budget;
            // In slices, so a single long match cannot hold the frame.
            while (performance.now() < until && run.advance(240)) {
                // Fighting.
            }
        }
        if (this.yardstick !== null) {
            // Its own slice rather than a share of the run's, so measuring slows the frame rather than the run.
            const until = performance.now() + budget;
            while (performance.now() < until && this.yardstick.advance(240)) {
                // Measuring.
            }
            if (this.yardstick.done) {
                this.measured = this.yardstick.report();
                this.measurements.set(this.measuringAgainst, this.measured);
                this.yardstick = null;
            }
        }
        if (this.grid !== null) {
            const until = performance.now() + budget;
            while (performance.now() < until && this.grid.advance(240)) {
                // Measuring.
            }
            if (this.grid.done) {
                this.gridResult = this.grid.report();
                this.grid = null;
            }
        }
    }
}
