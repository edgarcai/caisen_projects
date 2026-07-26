import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  publicDir: "public",
  build: {
    outDir: "dist-h5",
    emptyOutDir: true,
    sourcemap: true,
    target: "es2020",
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
    strictPort: true,
  },
  test: {
    environment: "node",
    include: ["tests-h5/unit/**/*.test.ts", "tests-h5/integration/**/*.test.ts"],
    coverage: {
      reporter: ["text", "json-summary"],
    },
  },
});
