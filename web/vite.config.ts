import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  server: {
    host: "127.0.0.1",
    port: Number(process.env.WEB_PORT ?? 4311),
    strictPort: true,
    proxy: {
      "/api": { target: `http://127.0.0.1:${process.env.API_PORT ?? 4310}`, changeOrigin: false },
    },
  },
});
