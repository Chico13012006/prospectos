// Fase 6 (aditiva): a ação de workflow 'criar_oportunidade' delega ao ambiente
// (que grava em `oportunidades`, Fase 5) — sem tocar no fluxo de cadência do
// motor. Testa o bloco isolado com um ctx fake (não instancia o AmbienteSupabase
// real, que exigiria o motor/env). O org-scoping da escrita é do ambiente e está
// coberto pela RLS + teste de isolamento de oportunidades (Fase 5).
import { describe, it, expect } from 'vitest'
import { acaoCriarOportunidade, registrarBlocosPadrao } from '../blocos'

function ctxFake(config: Record<string, unknown>) {
  const criadas: { leadId: string; dados: { titulo?: string; valor?: number | null } }[] = []
  const logs: { evento: string; dados: unknown }[] = []
  const ctx = {
    leadId: 'L1',
    config,
    ambiente: {
      async criarOportunidade(leadId: string, dados: { titulo?: string; valor?: number | null }) {
        criadas.push({ leadId, dados })
      },
    },
    async log(evento: string, dados: unknown) { logs.push({ evento, dados }) },
  } as never
  return { ctx, criadas, logs }
}

describe("ação 'criar_oportunidade'", () => {
  it('está registrada no conjunto padrão de blocos', () => {
    expect(() => registrarBlocosPadrao().obterAcao('criar_oportunidade')).not.toThrow()
  })

  it('delega ao ambiente com título e valor da config', async () => {
    const { ctx, criadas, logs } = ctxFake({ titulo: 'Renovação laudo', valor: 1200 })
    const r = await acaoCriarOportunidade.executar(ctx)
    expect(r).toEqual({ tipo: 'continuar' })
    expect(criadas).toHaveLength(1)
    expect(criadas[0]).toEqual({ leadId: 'L1', dados: { titulo: 'Renovação laudo', valor: 1200 } })
    expect(logs[0].evento).toBe('oportunidade_criada')
  })

  it('valor inválido vira null; título vazio vira undefined (ambiente aplica o default)', async () => {
    const { ctx, criadas } = ctxFake({ valor: 'abc' })
    await acaoCriarOportunidade.executar(ctx)
    expect(criadas[0].dados).toEqual({ titulo: undefined, valor: null })
  })

  it('sem lead, lança (ação exige um lead)', async () => {
    const semLead = { config: {}, ambiente: {}, async log() {} } as never
    await expect(acaoCriarOportunidade.executar(semLead)).rejects.toThrow(/exige um lead/)
  })
})
