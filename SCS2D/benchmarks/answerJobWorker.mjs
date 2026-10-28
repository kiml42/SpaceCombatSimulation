// A job worker for answerSearch.ts. Plain JavaScript loading the TypeScript through tsx's
// API, since a worker started under tsx does not resolve the source's `.js` imports.
import { parentPort } from "node:worker_threads";
import { tsImport } from "tsx/esm/api";

const { jobHandler } = await tsImport("../host/answer.ts", import.meta.url);
const handle = jobHandler();
parentPort.on("message", (message) => {
    try {
        const reply = handle(message);
        if (reply !== null) parentPort.postMessage(reply);
    } catch (error) {
        parentPort.postMessage({ crash: String(error), stack: error?.stack, job: message.job });
    }
});
