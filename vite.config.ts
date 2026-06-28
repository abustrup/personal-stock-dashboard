import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// On GitHub Pages the app is served from /<repo>/, so production builds need a
// matching base path. Dev stays at / so localhost works unchanged. Override with
// BASE_PATH if the repo is renamed.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === "build" ? process.env.BASE_PATH ?? "/personal-stock-dashboard/" : "/",
}));
