import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
    stories: ["../app/**/*.stories.tsx", "../ui/**/*.stories.tsx", "../features/**/*.stories.tsx"],
    addons: [
        "@storybook/addon-vitest",
        "@storybook/addon-a11y",
        "@storybook/addon-docs",
        "storybook-addon-pseudo-states",
        "storybook-design-token",
    ],
    framework: "@storybook/react-vite",
    core: { disableTelemetry: true },
    viteFinal(config) {
        // The app's one-file build means nothing here.
        return {
            ...config,
            publicDir: false,
            plugins: (config.plugins ?? [])
                .flat()
                .filter((p) => !(p && typeof p === "object" && "name" in p && p.name === "vite:singlefile")),
        };
    },
};

export default config;
