import { NEUTRAL } from "./teams.js";

/**
 * The colour each cost is shown in, wherever it is: a store's gauge in the
 * battle, the words on an upgrade card and a fleet's bill. The same on every
 * side, so it reads at a glance, and kept clear of the sides' hues, a gun's
 * amber and green load colours and charge's violet.
 */
export const RESOURCE_COLOURS = {
    /** The grey of a neutral hull. */
    metal: NEUTRAL.hull,
    fuel: "#2ec4b6",
    /** Copper, the robots' work. */
    build: "#d98f4e",
} as const;
