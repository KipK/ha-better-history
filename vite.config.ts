import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: "src/index.ts",
        define: "src/define.ts",
        picker: "src/picker.ts",
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
