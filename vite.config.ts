import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  nitro: {
    preset: "bun", // must match the Bun runtime used by the Coolify Dockerfile
  },
  tanstackStart: {
    server: { entry: "server" },
  },
});
