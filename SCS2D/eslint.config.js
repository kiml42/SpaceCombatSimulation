import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import storybook from "eslint-plugin-storybook";
import globals from "globals";
import tseslint from "typescript-eslint";

/** The React app and what it is built from. The pages `scripts/build.ts` bundles are not linted. */
const REACT = ["app/**/*.{ts,tsx}", "ui/**/*.{ts,tsx}", "features/**/*.{ts,tsx}", ".storybook/**/*.ts"];
const CONFIGS = ["*.config.ts"];

const acrossFolders = { group: ["../../*"], message: "Import across folders through ~/." };

/** Imports flow one way, app → features → ui: each layer may not reach up. */
function boundaries(...patterns) {
    return { "no-restricted-imports": ["error", { patterns: [acrossFolders, ...patterns] }] };
}

export default tseslint.config(
    { ignores: ["**/*", "!app/**", "!ui/**", "!features/**", "!.storybook/**", "!*.config.ts"] },
    {
        files: [...REACT, ...CONFIGS],
        extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
        languageOptions: {
            parserOptions: { project: ["./tsconfig.json", "./tsconfig.app.json"], tsconfigRootDir: import.meta.dirname },
        },
        rules: {
            "no-restricted-syntax": [
                "error",
                { selector: "ExportAllDeclaration", message: "No barrel files: import from the module itself." },
            ],
        },
    },
    { files: CONFIGS, languageOptions: { globals: globals.node } },
    {
        files: REACT,
        extends: [reactHooks.configs.flat["recommended-latest"]],
        languageOptions: { globals: globals.browser },
        rules: boundaries(),
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
