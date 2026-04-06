import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { tsLibPlugin } from "@diagram/ts-worker/vite-plugin";
import { simModelDtsPlugin } from "@diagram/ts-worker/vite-plugin-sim-model-dts";

export default defineConfig({
  plugins: [react(), tsLibPlugin(), simModelDtsPlugin()],
  worker: {
    format: "es",
  },
});
