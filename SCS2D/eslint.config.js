import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import storybook from "eslint-plugin-storybook";
import globals from "globals";
import tseslint from "typescript-eslint";

/** The React app and what it is built from, which are held to its import boundaries as well. */
const REACT = ["app/**/*.{ts,tsx}", "ui/**/*.{ts,tsx}", "features/**/*.{ts,tsx}", ".storybook/**/*.ts"];

const acrossFolders = { group: ["../../*"], message: "Import across folders through ~/." };

/** Imports flow one way, app → features → ui: each layer may not reach up. */
function boundaries(...patterns) {
    return { "no-restricted-imports": ["error", { patterns: [acrossFolders, ...patterns] }] };
}

export default tseslint.config(
    { ignores: ["dist/**", "runs/**", "notes/**", "test-results/**", "storybook-static/**"] },
    js.configs.recommended,
    tseslint.configs.recommended,
    {
        rules: {
            // A name starting with _ is a deliberate discard, as when destructuring a field away.
            "@typescript-eslint/no-unused-vars": [
                "error",
                { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" },
            ],
        },
    },
    { files: ["**/*.js"], languageOptions: { globals: globals.node } },
    {
        files: REACT,
        extends: [reactHooks.configs.flat["recommended-latest"]],
        rules: {
            ...boundaries(),
            "no-restricted-syntax": [
                "error",
                { selector: "ExportAllDeclaration", message: "No barrel files: import from the module itself." },
            ],
        },
    },
    { files: ["features/**"], rules: boundaries({ group: ["~/app/*"], message: "A feature does not import the app." }) },
    {
        files: ["ui/**"],
        rules: boundaries({
            group: ["~/app/*", "~/features/*"],
            message: "ui/ is presentational: it takes plain props and imports nothing above it.",
        }),
    },
    { files: ["**/*.stories.tsx"], extends: [storybook.configs["flat/recommended"]] },
);
