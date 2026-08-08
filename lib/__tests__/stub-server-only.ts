// Stub de 'server-only' para o vitest. O pacote real lança ao ser importado fora
// de um Server Component; nos testes (node) queremos apenas um no-op para poder
// exercitar a lógica pura de módulos server-only (ex.: normalizarAnalise). A trava
// de verdade continua ativa no build do Next. Ver alias em vitest.config.ts.
export {}
