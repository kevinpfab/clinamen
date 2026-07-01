import { defineConfig } from "vite";

export default defineConfig({
  server: {
    allowedHosts: [".free.pinggy.net", ".pinggy-free.link"],
  },
});
