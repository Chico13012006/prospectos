// Prova o escopo do cancelamento por opt-out (item 5 da entrega): cancela SÓ
// execuções de campanhas tipo='prospeccao' do lead. Renovação/outros tipos e
// outras organizações continuam intocados — regressão explícita pedida na
// TRAVA CRÍTICA da entrega.
import { describe, expect, it } from 'vitest'
import { BancoFalso } from '@/lib/templates/__tests__/bancoFalso'
import { cancelarExecucoesProspeccaoDoLead } from '../cancelamentoServidor'

const ORG = 'org-1'
const OUTRA_ORG = 'org-2'
const LEAD = 'lead-1'

function banco(dados: {
  campanhas?: Record<string, unknown>[]
  workflow_execucoes?: Record<string, unknown>[]
}) {
  return new BancoFalso({
    campanhas: dados.campanhas ?? [],
    workflow_execucoes: dados.workflow_execucoes ?? [],
  })
}

describe('cancelarExecucoesProspeccaoDoLead', () => {
  it('cancela execução em_andamento de campanha de prospecção do lead', async () => {
    const db = banco({
      campanhas: [{ id: 'camp-prospeccao', organizacao_id: ORG, tipo: 'prospeccao' }],
      workflow_execucoes: [
        { id: 'exec-1', organizacao_id: ORG, lead_id: LEAD, campanha_id: 'camp-prospeccao', status: 'em_andamento' },
      ],
    })
    const r = await cancelarExecucoesProspeccaoDoLead(db.cliente(), ORG, LEAD)
    expect(r.canceladas).toBe(1)
    expect(db.linhas('workflow_execucoes')[0].status).toBe('cancelado')
  })

  it('NÃO cancela execução de campanha de renovação (regressão obrigatória)', async () => {
    const db = banco({
      campanhas: [
        { id: 'camp-prospeccao', organizacao_id: ORG, tipo: 'prospeccao' },
        { id: 'camp-renovacao', organizacao_id: ORG, tipo: 'renovacao' },
      ],
      workflow_execucoes: [
        { id: 'exec-prospeccao', organizacao_id: ORG, lead_id: LEAD, campanha_id: 'camp-prospeccao', status: 'aguardando' },
        { id: 'exec-renovacao', organizacao_id: ORG, lead_id: LEAD, campanha_id: 'camp-renovacao', status: 'aguardando' },
      ],
    })
    const r = await cancelarExecucoesProspeccaoDoLead(db.cliente(), ORG, LEAD)
    expect(r.canceladas).toBe(1)
    const execs = db.linhas('workflow_execucoes')
    expect(execs.find((e) => e.id === 'exec-prospeccao')?.status).toBe('cancelado')
    expect(execs.find((e) => e.id === 'exec-renovacao')?.status).toBe('aguardando')
  })

  it('não toca em execuções já concluídas/canceladas', async () => {
    const db = banco({
      campanhas: [{ id: 'camp-prospeccao', organizacao_id: ORG, tipo: 'prospeccao' }],
      workflow_execucoes: [
        { id: 'exec-concluido', organizacao_id: ORG, lead_id: LEAD, campanha_id: 'camp-prospeccao', status: 'concluido' },
        { id: 'exec-cancelado', organizacao_id: ORG, lead_id: LEAD, campanha_id: 'camp-prospeccao', status: 'cancelado' },
      ],
    })
    const r = await cancelarExecucoesProspeccaoDoLead(db.cliente(), ORG, LEAD)
    expect(r.canceladas).toBe(0)
  })

  it('não toca em execuções de outra organização (multi-tenant)', async () => {
    const db = banco({
      campanhas: [
        { id: 'camp-org1', organizacao_id: ORG, tipo: 'prospeccao' },
        { id: 'camp-org2', organizacao_id: OUTRA_ORG, tipo: 'prospeccao' },
      ],
      workflow_execucoes: [
        { id: 'exec-outra-org', organizacao_id: OUTRA_ORG, lead_id: LEAD, campanha_id: 'camp-org2', status: 'em_andamento' },
      ],
    })
    const r = await cancelarExecucoesProspeccaoDoLead(db.cliente(), ORG, LEAD)
    expect(r.canceladas).toBe(0)
    expect(db.linhas('workflow_execucoes')[0].status).toBe('em_andamento')
  })

  it('sem campanha de prospecção na organização: no-op, sem escrita', async () => {
    const db = banco({ campanhas: [{ id: 'camp-renovacao', organizacao_id: ORG, tipo: 'renovacao' }] })
    const r = await cancelarExecucoesProspeccaoDoLead(db.cliente(), ORG, LEAD)
    expect(r.canceladas).toBe(0)
    expect(db.escritas('workflow_execucoes')).toHaveLength(0)
  })
})
