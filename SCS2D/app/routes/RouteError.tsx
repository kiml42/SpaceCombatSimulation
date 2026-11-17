import { styled } from "@linaria/react";
import { Link, useRouteError } from "react-router";
import { download } from "~/features/skirmish/skirmishFile";
import { useStorage } from "~/features/storage/StorageContext";
import { HISTORY_STORAGE_KEY } from "~/scenarios/history";
import { SKIRMISH_STORAGE_KEY } from "~/scenarios/skirmish";
import { Button } from "~/ui/buttons/Button";
import { SETTINGS_KEY } from "./skirmish/skirmishFields";

const Main = styled.main`
    padding: 1.5rem;
    max-width: 50rem;

    > pre {
        white-space: pre-wrap;
    }

    > div {
        display: flex;
        gap: 0.75rem;
        align-items: center;
    }
`;

/**
 * What a page that threw shows in its place. The skirmish is exported as it
 * is kept, without reading it, since reading it may be what threw.
 */
export function RouteError() {
    const error = useRouteError();
    const storage = useStorage();
    const kept = (key: string): unknown => {
        try {
            const raw = storage.getItem(key);
            return raw === null ? null : JSON.parse(raw);
        } catch {
            return null;
        }
    };
    const skirmish = kept(SKIRMISH_STORAGE_KEY);
    const exportSkirmish = (): void => {
        const file = { setup: kept(SETTINGS_KEY) ?? undefined, skirmish, history: kept(HISTORY_STORAGE_KEY) ?? undefined };
        download("skirmish.skirmish.json", `${JSON.stringify(file, null, 2)}\n`);
    };
    return (
        <Main>
            <h1>Something went wrong</h1>
            <pre>{error instanceof Error ? error.message : String(error)}</pre>
            <div>
                {skirmish !== null && <Button onClick={exportSkirmish}>Export skirmish</Button>}
                <Link to="/">Back to the start</Link>
            </div>
        </Main>
    );
}
