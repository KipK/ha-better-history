import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/all.ts",
      formats: ["es"],
    },
    rollupOptions: {
      external: ["lit", "lit/decorators.js", "lit/directives/class-map.js", "@kipk/load-ha-components"],
      output: {
        entryFileNames: "all.js",
      },
    },
  },
});
