import { openingPlan, type OpeningRequest } from "./opening.js";

/** The worker a run's opening is bred in: one request a worker, ended with it when the settings change. */

const scope = self as unknown as {
    onmessage: ((event: MessageEvent<OpeningRequest>) => void) | null;
    postMessage(message: unknown): void;
};

scope.onmessage = (event: MessageEvent<OpeningRequest>) => scope.postMessage(openingPlan(event.data));
