/**
 * What each ship's robots have been bringing in lately, from the running
 * totals the snapshot carries (`ShipView.gatheredMetal`): the rise over the
 * last `INCOME_WINDOW` seconds of battle time, per minute. Presentation only,
 * and DOM-free so it is unit-tested.
 */

/** How far back the rate is measured, seconds of battle time. */
export const INCOME_WINDOW = 20;

interface Sample {
    readonly time: number;
    readonly total: number;
}

export class Income {
    private readonly samples = new Map<number, Sample[]>();

    /** Note `total` kg for `body` at battle `time`, and say its rate, kg a minute; 0 until there are two samples. */
    note(body: number, time: number, total: number): number {
        let kept = this.samples.get(body);
        // Wound back, or a new battle: start again.
        if (kept !== undefined && kept.length > 0 && time < kept[kept.length - 1]!.time) kept = undefined;
        if (kept === undefined) {
            kept = [];
            this.samples.set(body, kept);
        }
        if (kept.length === 0 || time > kept[kept.length - 1]!.time) kept.push({ time, total });
        while (kept.length > 2 && kept[1]!.time <= time - INCOME_WINDOW) kept.shift();
        const first = kept[0]!;
        const span = time - first.time;
        return span > 0 ? ((total - first.total) / span) * 60 : 0;
    }

    clear(): void {
        this.samples.clear();
    }
}

/** A rate as a tile shows it: tonnes a minute, to a tenth, or kilograms below a tonne. */
export function incomeText(kgPerMinute: number): string {
    return kgPerMinute >= 1000 ? `+${(kgPerMinute / 1000).toFixed(1)} t/min` : `+${Math.round(kgPerMinute)} kg/min`;
}
