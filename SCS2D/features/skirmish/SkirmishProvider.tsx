import { createContext, use, useEffect, useRef, useState, type ReactNode } from "react";
import { useStorage } from "~/features/storage/StorageContext";
import type { AnswerProgress } from "~/host/answer";
import { dropOldest, EMPTY_HISTORY, HISTORY_STORAGE_KEY, parseHistory, record, type History, type Played } from "~/scenarios/history";
import { enemyMultiplier, parseSkirmish, serialiseSkirmish, settingsOf, SKIRMISH_STORAGE_KEY, type Skirmish } from "~/scenarios/skirmish";
import { startSkirmishAnswer } from "./answerSearch";

/** What the enemy's search has come to, as the skirmish route shows it. */
export interface Answering {
    /** The latest finished generation, or null before the first. */
    readonly latest: AnswerProgress | null;
    /** Whether the search is running. */
    readonly running: boolean;
}

export interface SkirmishState {
    readonly skirmish: Skirmish | null;
    readonly history: History;
    /** The history with the enemy leading a generation still being fought at its head, shown but never kept; or null. */
    readonly leading: History | null;
    readonly answering: Answering;
    /** Replace the skirmish, keeping it; null forgets it. */
    setSkirmish(next: Skirmish | null): void;
    /** Record a match played, keeping the history. */
    recordMatch(played: Played): void;
    /** Replace the history, keeping it. */
    setHistory(next: History): void;
    /** Set the enemy's search going against the player's fleet, from the enemy as it stands. */
    answer(): void;
    /** Stop the search, if it is running. */
    stopAnswer(): void;
    /** Hear of each generation of the search as it finishes, while subscribed. */
    subscribe(listener: (now: AnswerProgress) => void): () => void;
}

const SkirmishContext = createContext<SkirmishState | null>(null);

export function useSkirmish(): SkirmishState {
    const state = use(SkirmishContext);
    if (state === null) throw new Error("useSkirmish outside a SkirmishProvider");
    return state;
}

/**
 * The skirmish under way, its history and the enemy's search for an answer,
 * above every route: the search goes on while the player looks elsewhere, and
 * the skirmish is kept in storage as it changes, so a reload or another tab
 * picks it up.
 */
export function SkirmishProvider({ children }: { readonly children: ReactNode }) {
    const storage = useStorage();
    const [skirmish, setSkirmishState] = useState<Skirmish | null>(() => {
        try {
            const kept = storage.getItem(SKIRMISH_STORAGE_KEY);
            return kept === null ? null : parseSkirmish(JSON.parse(kept));
        } catch {
            // Unreadable: start a new one.
            return null;
        }
    });
    const [history, setHistoryState] = useState<History>(() => {
        try {
            const kept = storage.getItem(HISTORY_STORAGE_KEY);
            return kept === null ? EMPTY_HISTORY : parseHistory(JSON.parse(kept));
        } catch {
            return EMPTY_HISTORY;
        }
    });
    const [leading, setLeading] = useState<History | null>(null);
    const [answering, setAnswering] = useState<Answering>({ latest: null, running: false });
    // The search's callbacks outlive a render, so they read these rather than the state they were started under.
    const now = useRef({ skirmish, history });
    const stop = useRef<(() => void) | null>(null);
    const listeners = useRef(new Set<(now: AnswerProgress) => void>());

    const setSkirmish = (next: Skirmish | null): void => {
        now.current.skirmish = next;
        setSkirmishState(next);
        try {
            if (next === null) storage.removeItem(SKIRMISH_STORAGE_KEY);
            else storage.setItem(SKIRMISH_STORAGE_KEY, JSON.stringify(serialiseSkirmish(next)));
        } catch {
            // Storage full or refused: the skirmish lasts as long as the page.
        }
    };
    /** Kept in storage, letting go of the oldest runs' fleets until it fits. */
    const setHistory = (next: History): void => {
        let kept = next;
        for (;;) {
            try {
                storage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(kept));
                break;
            } catch {
                const smaller = dropOldest(kept);
                if (smaller === null) break;
                kept = smaller;
            }
        }
        now.current.history = kept;
        setHistoryState(kept);
        setLeading(null);
    };
    const recordMatch = (played: Played): void => setHistory(record(now.current.history, played));

    const stopAnswer = (): void => {
        stop.current?.();
        stop.current = null;
        setAnswering((was) => ({ ...was, running: false }));
    };

    const progressed = (progress: AnswerProgress): void => {
        const current = now.current.skirmish;
        if (current === null) return;
        const row: Played = {
            kind: "search",
            round: current.round,
            seed: current.won!,
            winner: progress.onRound ? 1 : 0,
            player: current.player,
            enemy: progress.best,
            generation: progress.generation,
        };
        if (progress.leading) {
            // At the head of the timeline until the generation is done, and never kept.
            setLeading(record(now.current.history, row));
            return;
        }
        // Kept as it goes, so a reload carries on from the best so far, at the budget reached.
        setSkirmish({ ...current, enemy: progress.found ?? progress.best, multiplier: progress.multiplier });
        if (progress.found !== null) {
            stop.current?.();
            stop.current = null;
            recordMatch({
                kind: "answer",
                round: current.round,
                seed: current.won!,
                winner: 1,
                player: current.player,
                enemy: progress.found,
            });
        } else recordMatch(row);
        setAnswering({ latest: progress, running: progress.found === null });
        for (const listener of listeners.current) listener(progress);
    };

    const answer = (): void => {
        const current = now.current.skirmish;
        if (current === null || current.won === undefined) return;
        stop.current?.();
        setAnswering({ latest: null, running: true });
        stop.current = startSkirmishAnswer(
            {
                player: current.player,
                enemy: current.enemy,
                won: current.won,
                seed: (current.won ^ current.round) >>> 0,
                settings: settingsOf(current),
                budget: current.budget,
                multiplier: enemyMultiplier(current),
            },
            progressed,
        );
    };

    // Left while the enemy was answering, or opened on one that was: carry on from the best so far.
    const resume = useRef(answer);
    useEffect(() => {
        if (now.current.skirmish?.won !== undefined) resume.current();
        return () => {
            stop.current?.();
            stop.current = null;
        };
    }, []);

    const state: SkirmishState = {
        skirmish,
        history,
        leading,
        answering,
        setSkirmish,
        recordMatch,
        setHistory,
        answer,
        stopAnswer,
        subscribe: (listener) => {
            listeners.current.add(listener);
            return () => listeners.current.delete(listener);
        },
    };
    return <SkirmishContext value={state}>{children}</SkirmishContext>;
}
