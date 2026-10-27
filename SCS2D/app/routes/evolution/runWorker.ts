import EvolutionWorker from "~/host/evolutionWorker?worker&inline";
import { startRun, type RunControl, type RunStart, type RunWire } from "~/host/evolutionRun";

/** An evolution run, in a worker inlined into the app's one file, so it runs from disk as well as served. */
export function startEvolution(start: RunStart, received: (wire: RunWire) => void): RunControl {
    return startRun(start, received, () => new EvolutionWorker());
}
