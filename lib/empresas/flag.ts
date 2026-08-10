import 'server-only'

// Ativação GRADUAL da leitura via entidades (Empresa/Contato), tela por tela,
// com ROLLBACK INSTANTÂNEO. Controlada por env `EMPRESA_CONTATO_READS`:
//   - vazio/ausente  => tudo LEGADO (lê de leads) — padrão seguro
//   - "all" | "on"   => liga em todas as telas
//   - lista CSV      => liga só nas telas nomeadas, ex.: "lead-panel,base-leads"
// Rollback = tirar a tela da lista (ou esvaziar a env) e reiniciar. Como o
// adapter é comprovadamente equivalente ao legado (validação 2e: 0 diferenças em
// 520 leads), ligar/desligar não muda o dado exibido — só a FONTE.
export function leituraEntidadesLigada(tela: string): boolean {
  const v = (process.env.EMPRESA_CONTATO_READS ?? '').trim().toLowerCase()
  if (!v) return false
  if (v === 'all' || v === 'on') return true
  return v.split(',').map((s) => s.trim()).includes(tela.toLowerCase())
}
