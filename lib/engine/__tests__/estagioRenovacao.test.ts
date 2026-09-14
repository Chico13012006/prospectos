// `renovacao` é estágio de cliente, não de prospecção: o motor comum de
// follow-up e a "próxima etapa" manual não podem alcançá-lo.
import { describe, expect, it } from 'vitest'
import { ESTAGIO_RENOVACAO } from '@/lib/leads/estagioInicial'
import { SimulatedProvider } from '../email/simulatedProvider'
import { executarAcao } from '../flows/executarAcao'
import { followUp } from '../flows/followUp'
import { MemoryStore } from '../store/memoryStore'
import { ESTAGIOS_EM_CADENCIA, proximoEstagio } from '../templates'
import { makeLead, ONTEM, SEMANA_PASSADA } from './helpers'

describe('estágio renovacao fora da cadência comum', () => {
  it('não é um estágio em cadência (follow_up continua sendo)', () => {
    expect(ESTAGIOS_EM_CADENCIA).not.toContain(ESTAGIO_RENOVACAO)
    expect(ESTAGIOS_EM_CADENCIA).toContain('follow_up')
  })

  it('o motor de follow-up não seleciona cliente em renovacao, nem para encerrar', async () => {
    const cliente = makeLead({ estagio: 'renovacao', data_validade: '2026-10-01', ultimo_contato: SEMANA_PASSADA, proxima_acao_data: ONTEM })
    const emFollowUp = makeLead({ estagio: 'follow_up', ultimo_contato: SEMANA_PASSADA, proxima_acao_data: ONTEM })
    const store = new MemoryStore([cliente, emFollowUp])

    expect((await store.leadsParaFollowup()).map((l) => l.id)).toEqual([emFollowUp.id])
    expect(await store.leadsEsgotadosSemResposta()).toEqual([])
  })

  it('a rodada de follow-up não envia nada ao cliente em renovacao', async () => {
    const cliente = makeLead({ estagio: 'renovacao', data_validade: '2026-10-01', ultimo_contato: SEMANA_PASSADA, proxima_acao_data: ONTEM })
    const store = new MemoryStore([cliente])
    const email = new SimulatedProvider()

    const r = await followUp(store, email)

    expect(r).toEqual({ enviados: 0, elegiveis: 0, encerrados: 0 })
    expect(email.enviados).toHaveLength(0)
    expect((await store.buscarLead(cliente.id))?.estagio).toBe('renovacao')
  })

  it('"Executar próxima etapa" não tem etapa para renovacao e não envia', async () => {
    expect(proximoEstagio(ESTAGIO_RENOVACAO)).toBe(ESTAGIO_RENOVACAO)
    const cliente = makeLead({ estagio: 'renovacao', data_validade: '2026-10-01' })
    const store = new MemoryStore([cliente])
    const email = new SimulatedProvider()

    const r = await executarAcao(store, email, { leadId: cliente.id })

    expect(r).toEqual({ ok: false, motivo: 'sem_proximo_estagio', estagio: 'renovacao' })
    expect(email.enviados).toHaveLength(0)
    expect(store.interacoes).toHaveLength(0)
  })
})
