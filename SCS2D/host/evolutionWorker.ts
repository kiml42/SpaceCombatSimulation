import { runLoop, sliced, type RunControl, type RunMessage } from "./evolutionRun.js";

/** The worker an evolution run is fought in: started by one message, paused and resumed by others, and stopped by being ended. */

const scope = self as unknown as {
    onmessage: ((event: MessageEvent<RunMessage>) => void) | null;
    postMessage(message: unknown): void;
};

let control: RunControl | null = null;
scope.onmessage = (event: MessageEvent<RunMessage>) => {
    const message = event.data;
    if ("start" in message) {
        control?.stop();
        // A timeout a slice, not a tight loop, so a pause can come in between them.
        control = sliced(
            runLoop(message.start, (wire) => scope.postMessage(wire)),
            (tick) => setTimeout(tick, 0),
        );
    } else control?.setPaused(message.paused);
};
