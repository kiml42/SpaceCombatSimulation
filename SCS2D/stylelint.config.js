/** Plain CSS, and the CSS inside Linaria's `styled` and `css` templates. */
export default {
    extends: ["stylelint-config-standard"],
    overrides: [{ files: ["**/*.{ts,tsx}"], customSyntax: "postcss-styled-syntax" }],
};
