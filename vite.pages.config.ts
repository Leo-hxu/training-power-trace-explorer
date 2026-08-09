import { cpSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "github-pages",
  base: "/training-power-trace-explorer/",
  plugins: [
    react(),
    {
      name: "copy-public-trace-data",
      closeBundle() {
        cpSync("github-pages/public-data", "pages-dist/public-data", { recursive: true });
      },
    },
  ],
  build: {
    outDir: "../pages-dist",
    emptyOutDir: true,
    sourcemap: true,
  },
});

