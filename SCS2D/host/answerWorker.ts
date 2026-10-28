import { searchLoop, searchPool, type JobPort, type SearchInput } from "./answer.js";

/**
 * The worker the skirmish enemy's search runs in: started by one message, and
 * stopped by being ended. Handed channels to job workers, it deals the search
 * out to them; otherwise it fights it itself.
 */

const scope = self as unknown as {
    onmessage: ((event: MessageEvent<SearchInput & { ports?: MessagePort[] }>) => void) | null;
    postMessage(message: unknown): void;
};

scope.onmessage = (event) => {
    scope.onmessage = null;
    const { ports = [], ...input } = event.data;
    const post = (wire: unknown): void => scope.postMessage(wire);
    if (ports.length > 0) {
        searchPool(input, post, ports as unknown as JobPort[]);
        return;
    }
    const run = searchLoop(input, post);
    // A tight loop would do, as nothing comes in once it starts; a timeout a
    // slice keeps the worker answering to being ended.
    const tick = (): void => {
        if (run()) setTimeout(tick, 0);
    };
    tick();
};
