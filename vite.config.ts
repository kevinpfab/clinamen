import { defineConfig } from "vite";

export default defineConfig({
  // The piece ships as a standalone bundle dropped into the portfolio's static
  // output (served under /clinamen/). Relative asset URLs let the build run
  // from any subpath without hardcoding one.
  base: "./",
  server: {
    // Dev-only tunneling for `dev:tunnel` / `dev:lan`; ignored by the build.
    allowedHosts: [".free.pinggy.net", ".pinggy-free.link"],
  },
  build: {
    // Split three.js into its own long-lived chunk so app-code changes don't
    // bust the (much larger) vendor cache.
    rollupOptions: {
      output: {
        manualChunks: {
          three: ["three"],
        },
      },
    },
  },
});
