import OpeningWorker from "~/host/openingWorker?worker&inline";
import type { MatchPlan } from "~/evolution/match";
import type { OpeningRequest } from "~/host/opening";

/** Breed a run's opening in a worker, inlined as the run's is; `cancel` ends it, unanswered. */
export function breedOpening(request: OpeningRequest, answered: (plan: MatchPlan | null) => void): { cancel(): void } {
    const worker = new OpeningWorker();
    worker.onmessage = (event: MessageEvent<MatchPlan | null>) => {
        worker.terminate();
        answered(event.data);
    };
    worker.postMessage(request);
    return { cancel: () => worker.terminate() };
}
