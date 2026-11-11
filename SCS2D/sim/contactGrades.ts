import { RESTITUTION, type Contacts } from "./collision.js";
import type { Damage } from "./damage.js";
import { ceil, floor, max, min } from "./math.js";

/**
 * How hard a contact was, as the share of the weaker module it met that the energy it lost would take.
 * Below `BUMP_SHARE` it is a touch: hulls resting or rocking against each other, which lose a
 * millionth or less.
 */
export const BUMP_SHARE = 1e-5;
/** At or above this share, a crash: enough to matter to the module it met. */
export const CRASH_SHARE = 1e-2;
/** Seconds a pair must go without touching before their next contact is a new encounter. */
export const ENCOUNTER_GAP = 1;

const TOUCH = 0;
const BUMP = 1;
const CRASH = 2;

/**
 * Contacts counted by encounter and graded by how hard they were, so that a ship settling against
 * another, or bouncing a few times after one bump, counts once and not every step it touches.
 *
 * An encounter is a run of contacts between one pair of bodies with no gap of `ENCOUNTER_GAP` in
 * it, counted as its hardest contact: a bump, or a crash. One of nothing but touches counts as
 * neither. Scoring only, so it changes nothing in the battle.
 */
export class ContactGrades {
    /** Encounters whose hardest contact was a bump. */
    bumps = 0;
    /** Encounters with a crash in them. */
    crashes = 0;
    private steps = 0;
    /** Each pair in an encounter, by `a * PAIR + b`: the step it last touched on, times four, plus its grade. */
    private readonly live = new Map<number, number>();

    /** Count this step's contacts, after the damage pass has spent them. */
    tally(contacts: Contacts, damage: Damage, dt: number): void {
        const step = ++this.steps;
        const gap = ceil(ENCOUNTER_GAP / dt);
        for (let k = 0; k < contacts.count; k++) {
            const energy = 0.5 * (1 - RESTITUTION) * contacts.closing[k]! * contacts.impulse[k]!;
            const grade = gradeOf(energy, weaker(damage, contacts, k));
            const key = contacts.a[k]! * PAIR + contacts.b[k]!;
            const was = this.live.get(key);
            let had = TOUCH;
            if (was !== undefined && step - floor(was / 4) <= gap) had = was % 4;
            else if (energy <= 0) continue;
            if (grade > had) {
                if (had === BUMP) this.bumps--;
                if (grade === BUMP) this.bumps++;
                else this.crashes++;
            }
            this.live.set(key, step * 4 + max(grade, had));
        }
        if (step % gap === 0) for (const [key, was] of this.live) if (step - floor(was / 4) > gap) this.live.delete(key);
    }
}

/** Bodies fewer than this, so a pair packs into one safe integer. */
const PAIR = 1 << 21;

function gradeOf(energy: number, capacity: number): number {
    // Nothing to measure against is kernel on kernel: rocks, not pilots.
    if (!(energy > 0) || !(capacity > 0)) return TOUCH;
    const share = energy / capacity;
    return share >= CRASH_SHARE ? CRASH : share >= BUMP_SHARE ? BUMP : TOUCH;
}

/** The capacity of the weaker module at contact `k` with one on record, or 0 for neither. */
function weaker(damage: Damage, contacts: Contacts, k: number): number {
    const a = damage.capacityOf(contacts.a[k]!, contacts.moduleA[k]!);
    const b = damage.capacityOf(contacts.b[k]!, contacts.moduleB[k]!);
    return a > 0 && b > 0 ? min(a, b) : max(a, b);
}
