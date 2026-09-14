import { describe, it, expect } from 'vitest'
import { processarRespostaPositivaProspeccao, type DepsGatilhoProspeccao, type EntradaGatilhoProspeccao } from '../gatilhoProspeccao'
import { atribuirResponsavelHandoff } from '../handoffService'
import { MemoryHandoffRepository } from './memoryRepository'
import { MemoryNotificacaoRepository } from '../../notificacoes/__tests__/memoryRepository'
import type { EnviadorGrupo } from '../../notificacoes/types'

const ORG_A = 'org-a'
const ORG_B = 'org-b'
const GRUPO = '120363019502650977-group'

function cenario(opts: { grupo?: string | null; envio?: 'ok' | 'offline' } = {}) {
  const handoff = new MemoryHandoffRepository()
    .addUsuario({ id: 'bruno', organizacaoId: ORG_A, nome: 'Bruno', email: 'bruno@a' })
    .addUsuario({ id: 'silmara', organizacaoId: ORG_A, nome: 'Silmara', email: 'silmara@a' })
    .addUsuario({ id: 'ana-b', organizacaoId: ORG_B, nome: 'Ana', email: 'ana@b' })
    .participar(ORG_A, 'bruno').participar(ORG_A, 'silmara').participar(ORG_B, 'ana-b')
    .addLead({ id: 'la1', organizacaoId: ORG_A, responsavelId: 'sdr' })
    .addLead({ id: 'la2', organizacaoId: ORG_A })
    .addLead({ id: 'lb1', organizacaoId: ORG_B })
  const notif = new MemoryNotificacaoRepository()
  const chamadas: { grupoId: string; mensagem: string }[] = []
  let modo = opts.envio ?? 'ok'
  const enviar: EnviadorGrupo = async (grupoId, mensagem) => {
    chamadas.push({ grupoId, mensagem })
    return modo === 'ok' ? { ok: true, providerMessageId: `z${chamadas.length}` } : { ok: false, codigo: 'zapi_desconectada', mensagem: 'offline' }
  }
  const grupo = opts.grupo === undefined ? GRUPO : opts.grupo
  const deps: DepsGatilhoProspeccao = { handoff, notificacoes: { repo: notif, enviar, lerGrupoId: async () => grupo } }
  return { deps, handoff, notif, chamadas, setEnvio: (m: 'ok' | 'offline') => { modo = m } }
}

const entrada = (leadId: string, eventoId = `email:<${leadId}@msg>`, org = ORG_A): EntradaGatilhoProspeccao => ({
  organizacaoId: org, leadId, eventoId, empresa: 'ACME', contatoNome: 'Ana Silva', etapaCadencia: 'follow-up 2',
})

describe('gatilho de prospecção — resposta positiva → handoff → aviso', () => {
  it('3/15. primeiro handoff: round-robin, lead atribuído, aviso enviado com responsável e origem', async () => {
    const { deps, handoff, notif, chamadas } = cenario()
    const r = await processarRespostaPositivaProspeccao(deps, entrada('la1'))
    expect(r.handoff.tipo).toBe('atribuido')
    if (r.handoff.tipo !== 'atribuido') return
    expect(r.handoff.motivo).toBe('round_robin')
    expect(r.responsavel).toEqual({ id: 'bruno', nome: 'Bruno', email: 'bruno@a' })
    expect(handoff.lead('la1')?.responsavelId).toBe('bruno')
    expect(r.notificacao?.tipo).toBe('enviada')
    expect(chamadas).toHaveLength(1)
    expect(chamadas[0].grupoId).toBe(GRUPO)
    expect(chamadas[0].mensagem).toContain('NOVO LEAD INTERESSADO')
    expect(chamadas[0].mensagem).toContain('Responsável: @Bruno')
    expect(chamadas[0].mensagem).toContain('Origem: Respondeu ao follow-up 2')
    expect(notif.linhas[0]).toMatchObject({ handoffId: r.handoff.handoff.id, status: 'enviada', organizacaoId: ORG_A })
  })

  it('4/16. reativação: mesmo responsável, cursor parado, aviso de "voltou a responder"', async () => {
    const { deps, handoff, chamadas } = cenario()
    const primeiro = await processarRespostaPositivaProspeccao(deps, entrada('la1', 'ev-1'))
    if (primeiro.handoff.tipo !== 'atribuido') throw new Error('esperava atribuido')
    handoff.encerrarHandoff(primeiro.handoff.handoff.id) // voltou ao follow-up (fase futura)
    const cursor = handoff.cursor(ORG_A)

    const r = await processarRespostaPositivaProspeccao(deps, entrada('la1', 'ev-2'))
    expect(r.handoff.tipo).toBe('atribuido')
    if (r.handoff.tipo !== 'atribuido') return
    expect(r.handoff.motivo).toBe('reativacao')
    expect(r.responsavel?.id).toBe('bruno')
    expect(handoff.cursor(ORG_A)).toEqual(cursor)
    expect(chamadas).toHaveLength(2)
    expect(chamadas[1].mensagem).toContain('LEAD VOLTOU A RESPONDER')
    expect(chamadas[1].mensagem).toContain('retorna para o mesmo responsável comercial')
    expect(chamadas[1].mensagem).toContain('@Bruno')
  })

  it('7/8. evento duplicado: um handoff, um aviso, cursor não anda', async () => {
    const { deps, handoff, notif, chamadas } = cenario()
    await processarRespostaPositivaProspeccao(deps, entrada('la1', 'ev-x'))
    const r = await processarRespostaPositivaProspeccao(deps, entrada('la1', 'ev-x'))
    expect(r.handoff.tipo).toBe('ja_processado')
    expect(r.notificacao?.tipo).toBe('ja_enviada')
    expect(handoff.handoffs(ORG_A)).toHaveLength(1)
    expect(handoff.cursor(ORG_A).versao).toBe(1)
    expect(notif.linhas).toHaveLength(1)
    expect(chamadas).toHaveLength(1)
  })

  it('9. sem comercial → prospecção encerrada fica com o handoff, aguardando distribuição, SEM aviso', async () => {
    const { deps, handoff, notif, chamadas } = cenario()
    handoff.participar(ORG_A, 'bruno', false).participar(ORG_A, 'silmara', false)
    const r = await processarRespostaPositivaProspeccao(deps, entrada('la1'))
    expect(r.handoff.tipo).toBe('aguardando_distribuicao')
    expect(r.responsavel).toBeNull()
    expect(r.notificacao).toBeNull()
    expect(chamadas).toHaveLength(0)
    expect(notif.linhas).toHaveLength(0)
    expect(handoff.lead('la1')?.responsavelId).toBe('sdr') // não escolheu ninguém
  })

  it('10. grupo ausente → handoff válido, notificação registrada como configuracao_ausente', async () => {
    const { deps, handoff, notif, chamadas } = cenario({ grupo: null })
    const r = await processarRespostaPositivaProspeccao(deps, entrada('la1'))
    expect(r.handoff.tipo).toBe('atribuido')
    expect(r.notificacao?.tipo).toBe('configuracao_ausente')
    expect(handoff.lead('la1')?.responsavelId).toBe('bruno')
    expect(notif.linhas[0].status).toBe('configuracao_ausente')
    expect(chamadas).toHaveLength(0)
  })

  it('11/12. Z-API offline → handoff válido, notificação recuperável; reprocessar o evento NÃO avança o cursor', async () => {
    const { deps, handoff, notif, chamadas, setEnvio } = cenario({ envio: 'offline' })
    const r = await processarRespostaPositivaProspeccao(deps, entrada('la1', 'ev-1'))
    expect(r.handoff.tipo).toBe('atribuido')
    expect(r.notificacao?.tipo).toBe('falhou')
    expect(handoff.lead('la1')?.responsavelId).toBe('bruno')
    expect(handoff.cursor(ORG_A).versao).toBe(1)
    expect(notif.linhas[0]).toMatchObject({ status: 'falhou', tentativas: 1 })

    // O evento é reprocessado (fila reentrega): handoff idempotente, cursor parado,
    // o aviso pendente é tentado de novo — e agora sai, uma única vez.
    setEnvio('ok')
    const r2 = await processarRespostaPositivaProspeccao(deps, entrada('la1', 'ev-1'))
    expect(r2.handoff.tipo).toBe('ja_processado')
    expect(r2.notificacao?.tipo).toBe('enviada')
    expect(handoff.cursor(ORG_A).versao).toBe(1)
    expect(handoff.lead('la1')?.responsavelId).toBe('bruno')
    expect(chamadas).toHaveLength(2)
    expect(notif.linhas).toHaveLength(1)
    expect(notif.linhas[0].status).toBe('enviada')
  })

  it('13. lead de outra organização nunca é atribuído nem notificado', async () => {
    const { deps, handoff, notif, chamadas } = cenario()
    const r = await processarRespostaPositivaProspeccao(deps, entrada('lb1')) // lead da org B, chamado como org A
    expect(r.handoff.tipo).toBe('lead_nao_encontrado')
    expect(handoff.lead('lb1')?.responsavelId).toBeNull()
    expect(handoff.handoffs()).toHaveLength(0)
    expect(notif.linhas).toHaveLength(0)
    expect(chamadas).toHaveLength(0)
  })

  it('processo morreu entre o handoff e a intenção → repetição registra a intenção que faltou', async () => {
    const { deps, handoff, notif, chamadas } = cenario()
    // Só o handoff (Fase 1) aconteceu — o processo morreu antes de registrar a intenção.
    const primeiro = await atribuirResponsavelHandoff(handoff, { organizacaoId: ORG_A, leadId: 'la1', eventoId: 'ev-1', origem: 'prospeccao' })
    expect(primeiro.tipo).toBe('atribuido')
    expect(notif.linhas).toHaveLength(0)
    const r = await processarRespostaPositivaProspeccao(deps, entrada('la1', 'ev-1'))
    expect(r.handoff.tipo).toBe('ja_processado')
    expect(r.notificacao?.tipo).toBe('enviada')
    expect(handoff.handoffs(ORG_A)).toHaveLength(1)
    expect(notif.linhas).toHaveLength(1)
    expect(chamadas).toHaveLength(1)
  })
})
