/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Bind all interfaces, not just loopback — required for the Docker Compose
    // dev container (port publishing/service-name networking can't reach a
    // server bound to 127.0.0.1 inside the container). Baked in here rather
    // than passed as a `--host` CLI flag: pnpm's arg-forwarding through
    // `run dev -- --host 0.0.0.0` was observed to pass a literal `--` into
    // Vite's argv, which Vite's CLI parser treats as "positional args from
    // here on," silently swallowing the flag.
    host: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
