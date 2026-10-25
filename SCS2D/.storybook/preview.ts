import type { Preview } from "@storybook/react-vite";
import "~/ui/tokens/tokens.css";

const preview: Preview = {
    parameters: {
        a11y: { test: "error" },
        backgrounds: { disable: true },
    },
};

export default preview;
