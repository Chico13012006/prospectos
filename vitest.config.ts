import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      // Espelha o paths "@/*" -> "./*" do tsconfig.
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['lib/engine/__tests__/**/*.test.ts'],
    setupFiles: ['lib/engine/__tests__/setup.ts'],
  },
})
