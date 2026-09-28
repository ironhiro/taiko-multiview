import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative base so the same build works from the container that serves it (see "배포" in
// README.md) and when the desktop shell loads it from a local folder mapping.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Dev-time stand-in for the one origin the deployed container gives, so the
      // browser only ever talks to one origin and CORS never comes into play.
      '/api': {
        // The end-to-end tests point this at their own mock backend.
        target: process.env.TAIKO_API_PROXY ?? 'http://localhost:5180',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
