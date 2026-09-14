// Fase 4 — comandos do grupo sobre o domínio real em memória (handoff Fase 1,
// outbox Fase 2/3) e um follow-up de retorno falso e observável.
import { describe, it, expect } from 'vitest'
import { processarComandoGrupo, reprocessarComandosGrupo, type DepsComandoGrupo } from '../comandoService'
import { MemoryComandoGrupoRepository } from './memoryComandoRepository'
import { MemoryHandoffRepository } from '../../handoff/__tests__/memoryRepository'
import { MemoryNotificacaoRepository } from '../../notificacoes/__tests__/memoryRepository'
import { atribuirResponsavelHandoff } from '../../handoff/handoffService'
import { processarAcompanhamentoHandoff, type DepsAcompanhamento } from '../../handoff/acompanhamentoService'
import { cicloChaveRetorno, type DepsRetornoFollowup } from '../../followup/retornoFollowup'
import type { EventoGrupo } from '../callbackGrupo'
import type { EnviadorGrupo } from '../../notificacoes/types'

const ORG_A = 'org-a'
const ORG_B = 'org-b'
const GRUPO_A = '120363019502650977-group'
const GRUPO_B = '120363000000000002-group'
const T0 = '2026-09-13T12:00:00.000Z'
const MIN = 60_000
const em = (ms: number) => new Date(new Date(T0).getTime() + ms).toISOString()

// Follow-up de retorno falso: registra inscrições/movimentos/agendamentos.
function retornoFake() {
  const inscricoes: { org: string; workflowId: string; leadId: string; campanhaId: string; cicloChave: string }[] = []
  const movidos: string[] = []
  const agendados: string[] = []
  let campanha: Awaited<ReturnType<DepsRetornoFollowup['resolverCampanhaRetorno']>> = { ok: true, campanhaId: 'camp-fup', workflowId: 'wf-fup' }
  let falharEm: 'mover' | 'agendar' | null = null
  const deps: DepsRetornoFollowup = {
    resolverCampanhaRetorno: async () => campanha,
    async inscrever(org, workflowId, leadId, campanhaId, cicloChave) {
      const existente = inscricoes.find((i) => i.org === org && i.workflowId === workflowId && i.leadId === leadId && i.cicloChave === cicloChave)
      if (existente) return { execucaoId: `ex-${inscricoes.indexOf(existente)}`, jaInscrito: true }
      inscricoes.push({ org, workflowId, leadId, campanhaId, cicloChave })
      return { execucaoId: `ex-${inscricoes.length - 1}`, jaInscrito: false }
    },
    async moverLeadParaFollowup(_org, leadId) { if (falharEm === 'mover') throw new Error('banco caiu ao mover lead'); movidos.push(leadId) },
    async agendarPrimeiroEnvio(_org, _c, execucaoId) { if (falharEm === 'agendar') throw new Error('fila fora'); agendados.push(execucaoId) },
  }
  return { deps, inscricoes, movidos, agendados, setCampanha: (c: typeof campanha) => { campanha = c }, setFalha: (f: typeof falharEm) => { falharEm = f } }
}

function cenario() {
  const handoff = new MemoryHandoffRepository()
    .addUsuario({ id: 'bruno', organizacaoId: ORG_A, nome: 'Bruno', email: 'bruno@a' })
    .addUsuario({ id: 'silmara', organizacaoId: ORG_A, nome: 'Silmara', email: 'silmara@a' })
    .addUsuario({ id: 'ana-b', organizacaoId: ORG_B, nome: 'Ana', email: 'ana@b' })
    .participar(ORG_A, 'bruno').participar(ORG_A, 'silmara').participar(ORG_B, 'ana-b')
    .addLead({ id: 'la1', organizacaoId: ORG_A, empresa: 'Metalúrgica ABC', contatoNome: 'João Silva' })
    .addLead({ id: 'la2', organizacaoId: ORG_A, empresa: 'Padaria XYZ', contatoNome: 'Maria' })
    .addLead({ id: 'lb1', organizacaoId: ORG_B, empresa: 'Org B Ltda', contatoNome: 'Caio' })
  const notif = new MemoryNotificacaoRepository()
  const comandos = new MemoryComandoGrupoRepository().configurarGrupo(ORG_A, GRUPO_A).configurarGrupo(ORG_B, GRUPO_B)
  comandos.agoraFixo = T0
  const mensagensGrupo: string[] = []
  const enviar: EnviadorGrupo = async (_g, m) => { mensagensGrupo.push(m); return { ok: true, providerMessageId: `z${mensagensGrupo.length}` } }
  const retorno = retornoFake()
  let agora = T0
  const acomp: DepsAcompanhamento = {
    handoff, notificacoes: { repo: notif, enviar, lerGrupoId: async (org) => (org === ORG_A ? GRUPO_A : GRUPO_B) },
    lerJanelaMinutos: async () => 5, agora: () => new Date(agora), aleatorio: (() => { let i = 0; return () => ((i++ * 7) % 32) / 32 })(),
  }
  const deps: DepsComandoGrupo = { comandos, notificacoes: notif, handoff, retorno: retorno.deps, agora: () => new Date(agora) }

  async function handoffComCheckin(leadId: string, org = ORG_A) {
    handoff.agoraFixo = agora
    const r = await atribuirResponsavelHandoff(handoff, { organizacaoId: org, leadId, eventoId: `ev-${leadId}`, origem: 'prospeccao' })
    handoff.agoraFixo = null
    if (r.tipo !== 'atribuido') throw new Error(`esperava atribuido, veio ${r.tipo}`)
    agora = em(6 * MIN); comandos.agoraFixo = agora
    const a = await processarAcompanhamentoHandoff(acomp, org)
    if (a.enviados !== 1) throw new Error('check-in não enviado')
    const checkin = notif.linhas.find((n) => n.handoffId === r.handoff.id && n.tipo === 'handoff_checkin')!
    return { handoff: r, codigo: checkin.codigoRef!, checkin }
  }
  const evento = (texto: string, over: Partial<EventoGrupo> = {}): EventoGrupo => ({
    grupoId: GRUPO_A, providerMessageId: `msg-${Math.random().toString(36).slice(2)}`, remetente: '5511999998888',
    remetenteNome: 'Alguém do grupo', grupoNome: 'Comercial', texto, recebidoEm: agora, ...over,
  })
  return { handoff, notif, comandos, retorno, deps, acomp, mensagensGrupo, handoffComCheckin, evento, avancar: (iso: string) => { agora = iso; comandos.agoraFixo = iso }, processar: (e: EventoGrupo) => processarComandoGrupo(deps, e) }
}

const acompDe = (c: ReturnType<typeof cenario>) => c.acomp

describe('comando 1 — continuar comigo', () => {
  it('1/2/3. mesmo comercial, cursor parado, nenhum follow-up, check-in respondido, handoff segue aberto', async () => {
    const c = cenario()
    const { handoff: h, codigo } = await c.handoffComCheckin('la1')
    expect(c.mensagensGrupo[0]).toContain(`Ref: #${codigo}`)
    const cursor = c.handoff.cursor(ORG_A)
    const r = await c.processar(c.evento(`#${codigo} 1`))
    expect(r.tipo).toBe('concluido')
    if (r.tipo !== 'concluido') return
    expect(r.resultado).toBe('continuar')
    expect(c.handoff.lead('la1')?.responsavelId).toBe('bruno')
    expect(c.handoff.cursor(ORG_A)).toEqual(cursor)
    expect(c.retorno.inscricoes).toHaveLength(0)
    const aberto = await c.handoff.buscarHandoff(ORG_A, h.handoff.id)
    expect(aberto?.encerradoEm).toBeNull()
    expect(aberto?.status).toBe('em_contato_comercial')
    expect(c.comandos.linhas[0]).toMatchObject({ status: 'concluido', resultado: 'continuar', handoffId: h.handoff.id, comando: '1', codigoRef: codigo, remetente: '5511999998888' })
    // Não há nova pergunta: próximo ciclo de acompanhamento não envia nada.
    expect((await processarAcompanhamentoHandoff(acompDe(c), ORG_A)).enviados).toBe(0)
    expect(c.mensagensGrupo).toHaveLength(1)
  })
})

describe('comando 2 — voltar para follow-up', () => {
  it('4/5/6. encerra o handoff (motivo retorno_followup), inscreve no follow-up de retorno (FUP 1, ciclo handoff_retorno), lead em follow_up, sem round-robin', async () => {
    const c = cenario()
    const { handoff: h, codigo } = await c.handoffComCheckin('la1')
    const cursor = c.handoff.cursor(ORG_A)
    const r = await c.processar(c.evento(`#${codigo} 2`))
    expect(r.tipo).toBe('concluido')
    if (r.tipo !== 'concluido') return
    expect(r.resultado).toBe('retorno_followup')
    const fechado = await c.handoff.buscarHandoff(ORG_A, h.handoff.id)
    expect(fechado?.encerradoEm).not.toBeNull()
    expect(fechado?.encerradoMotivo).toBe('retorno_followup')
    expect(fechado?.responsavelId).toBe('bruno') // histórico preservado
    expect(c.handoff.lead('la1')?.responsavelId).toBe('bruno') // ownership não apagado
    expect(c.retorno.inscricoes).toEqual([{ org: ORG_A, workflowId: 'wf-fup', leadId: 'la1', campanhaId: 'camp-fup', cicloChave: cicloChaveRetorno(h.handoff.id) }])
    expect(c.retorno.movidos).toEqual(['la1'])
    expect(c.retorno.agendados).toEqual(['ex-0'])
    expect(c.handoff.cursor(ORG_A)).toEqual(cursor)
  })

  it('7/8. comando duplicado (mesmo messageId) e reenvio do callback não criam duas cadências nem encerram duas vezes', async () => {
    const c = cenario()
    const { codigo } = await c.handoffComCheckin('la1')
    const e = c.evento(`#${codigo} 2`)
    const r1 = await c.processar(e)
    const r2 = await c.processar(e)
    const r3 = await c.processar({ ...e })
    expect(r1.tipo).toBe('concluido')
    expect(r2.tipo).toBe('duplicado')
    expect(r3.tipo).toBe('duplicado')
    expect(c.retorno.inscricoes).toHaveLength(1)
    expect(c.retorno.agendados).toHaveLength(1)
    expect(c.comandos.linhas).toHaveLength(1)
    // Um SEGUNDO comando 2 (outro messageId) para o mesmo handoff já encerrado: rejeitado.
    const r4 = await c.processar(c.evento(`#${codigo} 2`))
    expect(r4).toMatchObject({ tipo: 'rejeitado', motivo: 'handoff_nao_aberto' })
    expect(c.retorno.inscricoes).toHaveLength(1)
  })

  it('23. falha parcial: follow-up inscrito mas mover/agendar falha → comando "falhou", handoff NÃO encerrado; reprocesso conclui sem duplicar', async () => {
    const c = cenario()
    const { handoff: h, codigo } = await c.handoffComCheckin('la1')
    c.retorno.setFalha('mover')
    const r = await c.processar(c.evento(`#${codigo} 2`))
    expect(r.tipo).toBe('falhou')
    expect((await c.handoff.buscarHandoff(ORG_A, h.handoff.id))?.encerradoEm).toBeNull() // nada de "encerrado sem cadência"
    expect(c.retorno.inscricoes).toHaveLength(1)
    expect(c.comandos.linhas[0]).toMatchObject({ status: 'falhou', resultado: 'erro_processamento' })
    expect(c.comandos.linhas[0].erro).toContain('banco caiu')

    c.retorno.setFalha(null)
    const rep = await reprocessarComandosGrupo(c.deps, ORG_A)
    expect(rep).toEqual({ processados: 1, concluidos: 1, falhas: 0 })
    expect(c.retorno.inscricoes).toHaveLength(1) // idempotente (jaInscrito)
    expect(c.retorno.movidos).toEqual(['la1'])
    expect(c.retorno.agendados).toEqual(['ex-0'])
    expect((await c.handoff.buscarHandoff(ORG_A, h.handoff.id))?.encerradoMotivo).toBe('retorno_followup')
    expect(c.comandos.linhas[0].status).toBe('concluido')
  })

  it('sem campanha de retorno → falhou recuperável, handoff segue aberto; configurada depois → reprocesso conclui', async () => {
    const c = cenario()
    const { handoff: h, codigo } = await c.handoffComCheckin('la1')
    c.retorno.setCampanha({ ok: false, motivo: 'sem_campanha_retorno', detalhe: 'configure a campanha' })
    const r = await c.processar(c.evento(`#${codigo} 2`))
    expect(r).toMatchObject({ tipo: 'falhou', motivo: 'sem_campanha_retorno' })
    expect((await c.handoff.buscarHandoff(ORG_A, h.handoff.id))?.encerradoEm).toBeNull()
    expect(c.retorno.inscricoes).toHaveLength(0)
    c.retorno.setCampanha({ ok: true, campanhaId: 'camp-fup', workflowId: 'wf-fup' })
    expect((await reprocessarComandosGrupo(c.deps, ORG_A)).concluidos).toBe(1)
    expect((await c.handoff.buscarHandoff(ORG_A, h.handoff.id))?.encerradoMotivo).toBe('retorno_followup')
  })

  it("processo morreu no meio ('processando' preso) → reprocesso retoma; 'processando' recente não é roubado", async () => {
    const c = cenario()
    const { codigo } = await c.handoffComCheckin('la1')
    const e = c.evento(`#${codigo} 2`)
    // Simula: registrado e reivindicado, mas morreu antes de qualquer efeito.
    const { comando } = await c.comandos.registrar(ORG_A, { grupoId: GRUPO_A, providerMessageId: e.providerMessageId, remetente: null, remetenteNome: null, texto: e.texto, codigoRef: codigo, comando: '2', recebidoEm: e.recebidoEm })
    await c.comandos.reivindicar(ORG_A, comando.id, em(-60 * MIN))
    expect((await reprocessarComandosGrupo(c.deps, ORG_A)).processados).toBe(0) // recente: outro worker pode estar nele
    c.avancar(em(20 * MIN))
    const rep = await reprocessarComandosGrupo(c.deps, ORG_A)
    expect(rep).toEqual({ processados: 1, concluidos: 1, falhas: 0 })
    expect(c.retorno.inscricoes).toHaveLength(1)
  })

  it('dois workers com o MESMO callback → só um executa (claim CAS)', async () => {
    const c = cenario()
    const { codigo } = await c.handoffComCheckin('la1')
    const e = c.evento(`#${codigo} 2`)
    let chegaram = 0; let liberar!: () => void
    const barreira = new Promise<void>((res) => { liberar = res })
    c.comandos.antesDeReivindicar = async () => { if (++chegaram === 2) liberar(); await barreira }
    const [a, b] = await Promise.all([c.processar(e), c.processar(e)])
    expect([a.tipo, b.tipo].sort()).toEqual(['concluido', 'concorrente'])
    expect(c.retorno.inscricoes).toHaveLength(1)
    expect(c.comandos.linhas).toHaveLength(1)
  })
})

describe('rejeições e isolamento', () => {
  it('9. grupo não configurado → ignora sem gravar', async () => {
    const c = cenario()
    await c.handoffComCheckin('la1')
    const r = await c.processar(c.evento('#ABCDEF 1', { grupoId: '120363999999999999-group' }))
    expect(r).toEqual({ tipo: 'ignorado', motivo: 'grupo_nao_configurado' })
    expect(c.comandos.linhas).toHaveLength(0)
  })

  it('10/22. comando vindo do grupo da org B com código da org A → código desconhecido em B; A intocada', async () => {
    const c = cenario()
    const { handoff: h, codigo } = await c.handoffComCheckin('la1')
    const r = await c.processar(c.evento(`#${codigo} 2`, { grupoId: GRUPO_B }))
    expect(r).toMatchObject({ tipo: 'rejeitado', motivo: 'codigo_desconhecido' })
    expect(c.comandos.linhas[0].organizacaoId).toBe(ORG_B)
    expect((await c.handoff.buscarHandoff(ORG_A, h.handoff.id))?.encerradoEm).toBeNull()
    expect(c.retorno.inscricoes).toHaveLength(0)
  })

  it('11. grupo associado a duas orgs → não processa, nada gravado', async () => {
    const c = cenario()
    const { codigo } = await c.handoffComCheckin('la1')
    c.comandos.configurarGrupo(ORG_B, GRUPO_A)
    const r = await c.processar(c.evento(`#${codigo} 2`))
    expect(r).toEqual({ tipo: 'ignorado', motivo: 'grupo_ambiguo' })
    expect(c.comandos.linhas).toHaveLength(0)
    expect(c.retorno.inscricoes).toHaveLength(0)
  })

  it('12/13/14. código inválido/desconhecido/ambíguo e comando inválido → registrados como ignorados, lead intacto', async () => {
    const c = cenario()
    const { handoff: h, codigo } = await c.handoffComCheckin('la1')
    const antes = { lead: c.handoff.lead('la1'), cursor: c.handoff.cursor(ORG_A) }
    const casos: [string, string][] = [
      ['#ZZZZZZ 2', 'codigo_desconhecido'],
      [`#${codigo} 5`, 'comando_invalido'],
      [`#${codigo} continuar`, 'comando_invalido'],
      [`#${codigo.slice(0, 5)} 1`, 'codigo_desconhecido'], // código truncado nunca casa (ambiguidade impossível)
    ]
    for (const [texto, motivo] of casos) {
      const r = await c.processar(c.evento(texto))
      expect(r).toMatchObject({ tipo: 'rejeitado', motivo })
    }
    expect(c.comandos.linhas.every((l) => l.status === 'ignorado')).toBe(true)
    expect(c.handoff.lead('la1')).toEqual(antes.lead)
    expect(c.handoff.cursor(ORG_A)).toEqual(antes.cursor)
    expect((await c.handoff.buscarHandoff(ORG_A, h.handoff.id))?.encerradoEm).toBeNull()
    expect(c.retorno.inscricoes).toHaveLength(0)
    // Texto normal do grupo nem é registrado.
    expect(await c.processar(c.evento('alguém viu o lead da ABC?'))).toEqual({ tipo: 'ignorado', motivo: 'sem_comando' })
  })

  it('remetente não é mapeado a usuário: qualquer participante do grupo configurado executa, e o telefone fica na auditoria', async () => {
    const c = cenario()
    const { codigo } = await c.handoffComCheckin('la1')
    const r = await c.processar(c.evento(`#${codigo} 1`, { remetente: '5511900000000', remetenteNome: 'Silmara' }))
    expect(r.tipo).toBe('concluido')
    expect(c.comandos.linhas[0]).toMatchObject({ remetente: '5511900000000', remetenteNome: 'Silmara' })
  })
})
