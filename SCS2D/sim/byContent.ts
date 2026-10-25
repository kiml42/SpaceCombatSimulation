/**
 * A pure function of plain data, remembering its last `kept` answers by the
 * data's JSON: for the questions breeding asks again and again of designs a
 * mutant left as they were. Only for a function whose answer follows from what
 * JSON keeps of its argument, and an answer nobody changes, since every caller
 * asking of the same data is handed the same one.
 */
export function byContent<A, T>(kept: number, compute: (argument: A) => T): (argument: A) => T {
    const answers = new Map<string, T>();
    return (argument) => {
        // Negative zero kept apart from zero, which JSON would otherwise make one.
        const key = JSON.stringify(argument, (_, value: unknown) => (Object.is(value, -0) ? "-0" : value));
        const known = answers.get(key);
        if (known !== undefined || answers.has(key)) {
            // The most recently asked, kept longest.
            answers.delete(key);
            answers.set(key, known!);
            return known!;
        }
        const answer = compute(argument);
        answers.set(key, answer);
        if (answers.size > kept) answers.delete(answers.keys().next().value!);
        return answer;
    };
}
