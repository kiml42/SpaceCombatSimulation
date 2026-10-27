import type { Entrant } from "~/evolution/match";
import { GridMeasure, Yardstick, type ChampionGrid, type YardstickReport } from "~/evolution/yardstick";
import type { RunControl } from "~/host/evolutionRun";
import type { AnyRun } from "./runView";

/**
 * A run on show and its measurements. The run is fought elsewhere — in a
 * worker, so it goes on while the tab is hidden — and `run` is its copy here;
 * the measurements are stepped on the page's clock in slices between frames.
 *
 * Mutable, and read by the page at each sample rather than held in React
 * state (DESIGN.md non-negotiable 5).
 */
export class RunDriver {
    run: AnyRun | null = null;
    paused = false;
    private control: RunControl | null = null;
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

    /** Put a run on show from its start, forgetting everything about the last, which stops being fought. */
    begin(run: AnyRun, control: RunControl | null = null): void {
        this.control?.stop();
        this.control = control;
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
        this.control?.setPaused(paused);
    }

    /** Stop fighting the run, as the page goes. */
    end(): void {
        this.control?.stop();
        this.control = null;
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

    /** Spend up to `budget` ms on each of whatever is being measured. */
    work(budget: number): void {
        if (this.yardstick !== null) {
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
