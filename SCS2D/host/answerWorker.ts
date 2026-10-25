import { searchLoop } from "./answer.js";

/** The worker the skirmish enemy's search runs in: started by one message, and stopped by being ended. */

const scope = self as unknown as {
    onmessage: ((event: MessageEvent) => void) | null;
    postMessage(message: unknown): void;
};

scope.onmessage = (event: MessageEvent) => {
    scope.onmessage = null;
    const run = searchLoop(event.data, (wire) => scope.postMessage(wire));
    // A tight loop would do, as nothing comes in once it starts; a timeout a
    // slice keeps the worker answering to being ended.
    const tick = (): void => {
        if (run()) setTimeout(tick, 0);
    };
    tick();
};
