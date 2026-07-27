import { defineConfig } from "vitest/config";
import coopDocument from "./config/coop.json";

const coopProxyTarget = process.env.SHELTER_COOP_UPSTREAM
  ?? coopDocument.transport.relay_upstream;
const coopProxy = {
  [coopDocument.transport.websocket_path]: {
    target: coopProxyTarget,
    ws: true,
  },
};

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
    proxy: coopProxy,
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
    strictPort: true,
    proxy: coopProxy,
  },
  test: {
    environment: "node",
    include: ["tests-h5/unit/**/*.test.ts", "tests-h5/integration/**/*.test.ts"],
    coverage: {
      reporter: ["text", "json-summary"],
    },
  },
});
