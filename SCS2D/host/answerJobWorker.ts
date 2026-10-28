import { jobHandler, type JobMessage } from "./answer.js";

/** A job worker of the skirmish enemy's search: handed a channel to the search, it fights each job sent down it. */

const scope = self as unknown as { onmessage: ((event: MessageEvent<{ port: MessagePort }>) => void) | null };

scope.onmessage = (event) => {
    scope.onmessage = null;
    const port = event.data.port;
    const handle = jobHandler();
    port.onmessage = (message: MessageEvent<JobMessage>) => {
        const reply = handle(message.data);
        if (reply !== null) port.postMessage(reply);
    };
};
