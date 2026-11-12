import { describe, expect, it } from "vitest";
import { Income, INCOME_WINDOW, incomeText } from "../render/income.js";

describe("income in the fleet tiles", () => {
    it("is the rise over the window, a minute's worth", () => {
        const income = new Income();
        expect(income.note(1, 0, 0)).toBe(0);
        expect(income.note(1, 10, 500)).toBeCloseTo(3000, 9);
        // Past the window, the oldest samples go and only the recent rise counts.
        income.note(1, INCOME_WINDOW + 5, 500);
        expect(income.note(1, INCOME_WINDOW * 2 + 10, 500)).toBe(0);
    });

    it("starts again when the battle is wound back", () => {
        const income = new Income();
        income.note(2, 0, 0);
        income.note(2, 30, 3000);
        expect(income.note(2, 5, 100)).toBe(0);
        expect(income.note(2, 15, 1100)).toBeCloseTo(6000, 9);
    });

    it("reads in tonnes from a tonne a minute", () => {
        expect(incomeText(450)).toBe("+450 kg/min");
        expect(incomeText(2340)).toBe("+2.3 t/min");
    });
});
