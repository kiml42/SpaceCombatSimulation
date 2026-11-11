import { describe, expect, it } from "vitest";
import { BUMP_SHARE, CRASH_SHARE, ContactGrades, Contacts, ENCOUNTER_GAP, RESTITUTION, type Damage } from "../sim/index.js";

/** Contacts graded by how hard they were and counted by encounter, so a ship rocking against another counts once. */

const DT = 1 / 60;
/** Every module can take this many joules. */
const CAPACITY = 1e6;
const damage = { capacityOf: () => CAPACITY } as unknown as Damage;

/** One step with a contact between bodies `a` and `b` losing `share` of a module, or none at all for `null`. */
function step(grades: ContactGrades, share: number | null, a = 0, b = 1): void {
    const contacts = new Contacts();
    if (share !== null) {
        contacts.push(a, b, 0, 0, 1, 0, 0.1, 0, 0);
        // What the damage pass would make of it: closing 1 m/s, and the impulse that loses that energy.
        contacts.closing[0] = 1;
        contacts.impulse[0] = (share * CAPACITY) / (0.5 * (1 - RESTITUTION));
    }
    grades.tally(contacts, damage, DT);
}

function quiet(grades: ContactGrades, seconds: number): void {
    for (let t = 0; t < seconds / DT; t++) step(grades, null);
}

describe("grading contacts", () => {
    it("counts hulls resting against each other as nothing at all", () => {
        const grades = new ContactGrades();
        for (let t = 0; t < 600; t++) step(grades, BUMP_SHARE / 100);
        expect([grades.bumps, grades.crashes]).toEqual([0, 0]);
    });

    it("counts a bump and the small bounces after it once", () => {
        const grades = new ContactGrades();
        step(grades, BUMP_SHARE * 10);
        for (let n = 0; n < 5; n++) {
            quiet(grades, ENCOUNTER_GAP / 2);
            step(grades, BUMP_SHARE * 2);
        }
        expect([grades.bumps, grades.crashes]).toEqual([1, 0]);
    });

    it("counts an encounter as its hardest contact", () => {
        const grades = new ContactGrades();
        step(grades, BUMP_SHARE * 10);
        step(grades, CRASH_SHARE * 2);
        expect([grades.bumps, grades.crashes]).toEqual([0, 1]);
    });

    it("counts a bump after a quiet spell as a new one", () => {
        const grades = new ContactGrades();
        step(grades, BUMP_SHARE * 10);
        quiet(grades, ENCOUNTER_GAP * 2);
        step(grades, BUMP_SHARE * 10);
        expect(grades.bumps).toBe(2);
    });

    it("keeps each pair's encounters apart", () => {
        const grades = new ContactGrades();
        step(grades, CRASH_SHARE, 0, 1);
        step(grades, CRASH_SHARE, 0, 2);
        expect(grades.crashes).toBe(2);
    });
});
