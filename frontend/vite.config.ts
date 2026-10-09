import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

// Which build a page came from, sent with its error reports (src/lib/diagnostics.ts). The
// image build has no .git, so the Dockerfile passes the commit in as BUILD_VERSION; a local
// build asks git; anything else is "dev".
function buildVersion(): string {
  if (process.env.BUILD_VERSION) {
    return process.env.BUILD_VERSION
  }
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'dev'
  } catch {
    return 'dev'
  }
}

// Relative base so the same build works from the container that serves it (see "배포" in
// README.md) and when the desktop shell loads it from a local folder mapping.
export default defineConfig({
  base: './',
  plugins: [react()],
  define: {
    'import.meta.env.VITE_BUILD_VERSION': JSON.stringify(buildVersion()),
  },
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
