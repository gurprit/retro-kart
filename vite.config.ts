import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  resolve: {
    alias: {
      '@colyseus/sdk': fileURLToPath(
        new URL('./src/game/network/CloudflareColyseusShim.ts', import.meta.url),
      ),
    },
  },
})
