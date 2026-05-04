import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  envDir: path.resolve(__dirname),
  server: {
    host: true,
    open: "/dev/index.html"
  }
});