import AnswerWorker from "~/host/answerWorker?worker&inline";
import { startAnswer, type AnswerInput, type AnswerProgress } from "~/host/answer";

/** The enemy's search, in a worker inlined into the app's one file, so it runs from disk as well as served. */
export function startSkirmishAnswer(input: AnswerInput, progress: (now: AnswerProgress) => void): () => void {
    return startAnswer(input, progress, () => new AnswerWorker());
}
