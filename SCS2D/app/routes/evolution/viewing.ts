import type { Entrant, Match } from "~/evolution/match";
import type { MatchRecord } from "~/evolution/run";
import type { BattleView } from "~/host/battleView";
import { pictureOf, type Picture } from "~/host/fleetPicture";

/** Compiled designs kept for the table: a few generations of a large population, which is what seeking back and forth revisits. */
const DESIGNS_KEPT = 512;

/** A match on show in the battle view, and who is fighting it, by id, and an opponent that has none. */
export interface Replay {
    readonly match: Match;
    readonly record: MatchRecord | null;
    readonly ids: readonly number[];
    readonly vs: string | null;
}

/**
 * What the page is watching: the battle view, the match on it, and what is
 * waiting to go on. Mutable, and changed only between frames and in handlers;
 * the page reads it at each sample (DESIGN.md non-negotiable 5).
 */
export class Viewing {
    view: BattleView | null = null;
    replay: Replay | null = null;
    /** Whether the match on show has been given up on, and the next one the run finishes should go on in its place. */
    skipping = false;
    /** Why a match picked could not be fought again. */
    note = "";
    /** Before a run, the first match its founders would fight, paused at its start, and what it was built from. */
    preview: { readonly key: string; readonly match: Match | null } = { key: "", match: null };
    /** A generation picked off the chart, to go to at the next frame. */
    seekTo: number | null = null;

    setView(view: BattleView | null): void {
        this.view = view;
        if (view !== null) this.showOn(view);
    }

    /** Put a match on, on the view if there is one. Whether there is. */
    watch(replay: Replay): boolean {
        this.replay = replay;
        this.skipping = false;
        this.note = "";
        if (this.view === null) return false;
        this.showOn(this.view);
        return true;
    }

    /** Show the match on, carrying on from where it is. */
    private showOn(view: BattleView): void {
        const replay = this.replay;
        if (replay !== null) view.show(replay.match.battle, true, false, [], () => replay.match.advance());
    }

    /** Take the match off, as the combatants come back on. */
    stop(): void {
        this.replay = null;
        this.skipping = false;
    }

    skip(): void {
        this.skipping = true;
    }

    cannot(note: string): void {
        this.note = note;
    }

    setPreview(key: string, match: Match | null): void {
        this.preview = { key, match };
    }

    seek(at: number): void {
        this.seekTo = at;
    }

    /** The generation picked since the last frame, once. */
    takeSeek(): number | null {
        const at = this.seekTo;
        this.seekTo = null;
        return at;
    }
}

/**
 * Designs compiled to draw and weigh, once each: an individual's id never
 * repeats within a run and its design never changes. A founder before a run
 * has no id, so it is held by the design itself.
 */
export class Pictures {
    private readonly byId = new Map<number, Picture>();
    private readonly founders = new WeakMap<Entrant, Picture>();

    of(id: number, entrant: Entrant): Picture {
        if (id < 0) {
            let held = this.founders.get(entrant);
            if (held === undefined) {
                held = pictureOf(entrant);
                this.founders.set(entrant, held);
            }
            return held;
        }
        let held = this.byId.get(id);
        if (held === undefined) {
            held = pictureOf(entrant);
            this.byId.set(id, held);
            // The oldest go first, which on a seek means the ones already scrolled past.
            while (this.byId.size > DESIGNS_KEPT) this.byId.delete(this.byId.keys().next().value!);
        }
        return held;
    }

    /** Forget a run's, whose ids the next run uses again. */
    clear(): void {
        this.byId.clear();
    }
}
