import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  base: "./",
  build: {
    outDir: "../.tooling/extension-build",
    emptyOutDir: true,
    rollupOptions: {
      input: fileURLToPath(new URL("./popup.html", import.meta.url)),
    },
  },
});
