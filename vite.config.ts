import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: "src/index.ts",
        define: "src/define.ts",
      },
      formats: ["es"],
    },
    rollupOptions: {
      external: ["lit", "lit/decorators.js", "lit/directives/class-map.js", "@kipk/load-ha-components"],
      output: {
        entryFileNames: "[name].js",
      },
    },
  },
});
