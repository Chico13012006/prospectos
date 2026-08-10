import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      // Espelha o paths "@/*" -> "./*" do tsconfig.
      '@': fileURLToPath(new URL('.', import.meta.url)),
      // 'server-only' lança fora de um Server Component; nos testes vira no-op
      // para exercitar a lógica pura de módulos server-only (ex.: lib/ia/*).
      'server-only': fileURLToPath(new URL('./lib/__tests__/stub-server-only.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    // Catch-all sob lib/**/__tests__ — cobre engine/workflows/leads/config/rbac
    // e os módulos novos das próximas fases sem precisar editar esta lista a cada um.
    include: ['lib/**/__tests__/**/*.test.ts'],
    setupFiles: ['lib/engine/__tests__/setup.ts'],
  },
})
