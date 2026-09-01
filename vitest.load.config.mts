import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/load/**/*.test.ts"],
    setupFiles: ["./tests/unit/setup.ts"],
    clearMocks: true,
    restoreMocks: true,
    testTimeout: 30_000,
  },
});
