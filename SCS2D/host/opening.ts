import { Coevolution, type CoevolutionConfig } from "../evolution/coevolution.js";
import type { Entrant, MatchPlan } from "../evolution/match.js";
import { Run, type RunConfig } from "../evolution/run.js";

/**
 * A run's opening, as the Evolution route shows it before the run starts,
 * bred in a worker (`openingWorker.ts`): breeding a first generation of two
 * large fleets takes seconds, which on the page would hang it.
 */

export interface OpeningRequest {
    readonly founders: readonly Entrant[];
    readonly rivals: readonly Entrant[];
    readonly config: Partial<RunConfig>;
    /** For a co-evolution run, which there is when there are rivals. */
    readonly coevolution: Partial<CoevolutionConfig> | null;
}

/** The opening, or null where a founder will not compile or there is none. */
export function openingPlan(request: OpeningRequest): MatchPlan | null {
    const { founders, rivals, config, coevolution } = request;
    if (founders.length === 0) return null;
    try {
        return rivals.length > 0
            ? new Coevolution(founders, rivals, config, coevolution ?? undefined).unmutatedOpeningPlan()
            : new Run(founders, config).unmutatedOpeningPlan();
    } catch {
        return null;
    }
}
