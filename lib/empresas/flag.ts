import 'server-only'

// Ativação GRADUAL da leitura via entidades (Empresa/Contato), tela por tela e
// por ORGANIZAÇÃO, com ROLLBACK INSTANTÂNEO. Controlada por env:
//   EMPRESA_CONTATO_READS:
//     - vazio/ausente => tudo LEGADO (lê de leads) — padrão seguro
//     - "all" | "on"  => liga em todas as telas
//     - lista CSV     => liga só nas telas nomeadas, ex.: "lead-panel,base-leads"
//   EMPRESA_CONTATO_READS_ORGS (opcional):
//     - vazio  => todas as organizações
//     - CSV de organizacao_id => liga SÓ nessas orgs (ex.: só a sua)
// Rollback = tirar a tela da lista (ou esvaziar a env) e reiniciar. Como o
// adapter é comprovadamente equivalente ao legado (validação 2e: 0 diferenças em
// 520 leads), ligar/desligar não muda o dado exibido — só a FONTE.
export function leituraEntidadesLigada(tela: string, org?: string): boolean {
  const v = (process.env.EMPRESA_CONTATO_READS ?? '').trim().toLowerCase()
  if (!v) return false
  const telaOn = v === 'all' || v === 'on' || v.split(',').map((s) => s.trim()).includes(tela.toLowerCase())
  if (!telaOn) return false

  const orgsEnv = (process.env.EMPRESA_CONTATO_READS_ORGS ?? '').trim()
  if (!orgsEnv) return true // sem restrição de org
  if (!org) return false
  return orgsEnv.split(',').map((s) => s.trim()).includes(org)
}
