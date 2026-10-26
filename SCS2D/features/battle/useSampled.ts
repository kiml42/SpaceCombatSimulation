import { useEffect, useEffectEvent, useState } from "react";

/** How often a figure read off a running battle is shown again: often enough to read, far less than every frame. */
export const SAMPLE_HZ = 10;

/**
 * `read()`, read again `SAMPLE_HZ` times a second. Return a string or a number:
 * those re-render only when they change, where an object would every time.
 */
export function useSampled<T extends string | number>(read: () => T): T {
    const [value, setValue] = useState(read);
    const sample = useEffectEvent(() => setValue(read()));
    useEffect(() => {
        const timer = window.setInterval(sample, 1000 / SAMPLE_HZ);
        return () => window.clearInterval(timer);
    }, []);
    return value;
}
