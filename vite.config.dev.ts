import { defineConfig } from "vite";

export default defineConfig({
  root: "dev",
  server: {
    fs: {
      allow: [".."]
    }
  }
});
