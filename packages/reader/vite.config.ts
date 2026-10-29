import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: Number(process.env.MAGAZINE_E2E_WEB_PORT ?? 5173),
    proxy: {
      "/api": `http://127.0.0.1:${process.env.MAGAZINE_E2E_API_PORT ?? 5174}`,
    },
  },
});
