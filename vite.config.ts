import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: resolve(__dirname, "src/renderer"),
  base: "./",
  publicDir: false,
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
    assetsDir: "assets",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "src/renderer/index.html"),
        settings: resolve(__dirname, "src/renderer/settings.html")
      }
    }
  }
});
