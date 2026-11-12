interface Runs {
    readonly running: boolean;
    setRunning(running: boolean): void;
}

/** Pause a page's view for its menu, and how to carry on: playing again only if it was. */
export function pauseView(view: () => Runs | null): () => () => void {
    return () => {
        const paused = view();
        const was = paused?.running ?? false;
        paused?.setRunning(false);
        return () => {
            if (was) paused?.setRunning(true);
        };
    };
}
