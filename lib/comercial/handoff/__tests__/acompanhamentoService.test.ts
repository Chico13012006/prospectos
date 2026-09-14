// Fase 3 — check-in de acompanhamento. Relógio INJETADO (nunca o real):
// `agora` fixo no serviço e `agoraFixo` no fake para controlar atribuido_em.
import { describe, it, expect } from 'vitest'
import { limiteRevisao, processarAcompanhamentoHandoff, type DepsAcompanhamento } from '../acompanhamentoService'
import { atribuirResponsavelHandoff } from '../handoffService'
import { MemoryHandoffRepository } from './memoryRepository'
import { MemoryNotificacaoRepository } from '../../notificacoes/__tests__/memoryRepository'
import { montarMensagemCheckin, descreverTempoDecorrido } from '../../notificacoes/mensagens'
import { HANDOFF_REVISAO_MINUTOS_PADRAO } from '@/lib/config/workspaceConfig'
import type { EnviadorGrupo } from '../../notificacoes/types'

const ORG_A = 'org-a'
const ORG_B = 'org-b'
const GRUPO = '120363019502650977-group'
const T0 = '2026-09-13T12:00:00.000Z'
const MIN = 60_000
const DIA = 24 * 60 * MIN
const em = (deltaMs: number) => new Date(new Date(T0).getTime() + deltaMs).toISOString()

interface Opcoes { janela?: number | null; grupo?: string | null; envio?: 'ok' | 'offline' }

function cenario(o: Opcoes = {}) {
  const handoff = new MemoryHandoffRepository()
    .addUsuario({ id: 'bruno', organizacaoId: ORG_A, nome: 'Bruno', email: 'bruno@a' })
    .addUsuario({ id: 'silmara', organizacaoId: ORG_A, nome: 'Silmara', email: 'silmara@a' })
    .addUsuario({ id: 'ana-b', organizacaoId: ORG_B, nome: 'Ana', email: 'ana@b' })
    .participar(ORG_A, 'bruno').participar(ORG_A, 'silmara').participar(ORG_B, 'ana-b')
    .addLead({ id: 'la1', organizacaoId: ORG_A, empresa: 'Metalúrgica ABC', contatoNome: 'João Silva' })
    .addLead({ id: 'la2', organizacaoId: ORG_A, empresa: '', contatoNome: 'Maria' })
    .addLead({ id: 'lb1', organizacaoId: ORG_B, empresa: 'Org B Ltda', contatoNome: 'Caio' })
  const notif = new MemoryNotificacaoRepository()
  const chamadas: { grupoId: string; mensagem: string }[] = []
  let modo = o.envio ?? 'ok'
  const enviar: EnviadorGrupo = async (grupoId, mensagem) => {
    chamadas.push({ grupoId, mensagem })
    return modo === 'ok' ? { ok: true, providerMessageId: `z${chamadas.length}` } : { ok: false, codigo: 'zapi_desconectada', mensagem: 'offline' }
  }
  let grupo = o.grupo === undefined ? GRUPO : o.grupo
  let agora = T0
  const janela = o.janela === undefined ? null : o.janela
  const deps: DepsAcompanhamento = {
    handoff,
    notificacoes: { repo: notif, enviar, lerGrupoId: async () => grupo },
    // Simula a config da org: null = ausente → padrão de 7 dias.
    lerJanelaMinutos: async () => janela ?? HANDOFF_REVISAO_MINUTOS_PADRAO,
    agora: () => new Date(agora),
  }
  // Handoff atribuído em `quando` (relógio do fake fixado no momento da confirmação).
  async function atribuir(leadId: string, quando: string, org = ORG_A, eventoId = `ev-${leadId}`) {
    handoff.agoraFixo = quando
    const r = await atribuirResponsavelHandoff(handoff, { organizacaoId: org, leadId, eventoId, origem: 'prospeccao' })
    handoff.agoraFixo = null
    if (r.tipo !== 'atribuido') throw new Error(`esperava atribuido, veio ${r.tipo}`)
    return r
  }
  return {
    deps, handoff, notif, chamadas, atribuir,
    avancarPara: (iso: string) => { agora = iso },
    setEnvio: (m: 'ok' | 'offline') => { modo = m },
    setGrupo: (g: string | null) => { grupo = g },
    rodar: (org = ORG_A) => processarAcompanhamentoHandoff(deps, org),
  }
}

describe('acompanhamento — janela', () => {
  it('limiteRevisao subtrai a janela em minutos', () => {
    expect(limiteRevisao(new Date(T0), 7 * 24 * 60)).toBe(em(-7 * DIA))
    expect(limiteRevisao(new Date(T0), 5)).toBe(em(-5 * MIN))
  })

  it('1. handoff com 6d23h → não envia; 2. com 7d → envia', async () => {
    const c = cenario()
    await c.atribuir('la1', T0)
    c.avancarPara(em(7 * DIA - 60 * MIN))
    let r = await c.rodar()
    expect(r).toMatchObject({ vencidos: 0, enviados: 0 })
    expect(c.chamadas).toHaveLength(0)

    c.avancarPara(em(7 * DIA))
    r = await c.rodar()
    expect(r).toMatchObject({ vencidos: 1, enviados: 1, janelaMinutos: 10080 })
    expect(c.chamadas).toHaveLength(1)
    expect(c.chamadas[0].grupoId).toBe(GRUPO)
    expect(c.chamadas[0].mensagem).toContain('ACOMPANHAMENTO COMERCIAL — ProspectOS')
    expect(c.chamadas[0].mensagem).toContain('@Bruno, como ficou o lead Metalúrgica ABC?')
    expect(c.chamadas[0].mensagem).toContain('Contato: João Silva')
    expect(c.chamadas[0].mensagem).toContain('Responsável: Bruno')
    expect(c.chamadas[0].mensagem).toContain('Em contato comercial há 7 dias.')
  })

  it('3. janela configurada 5 min → envia após 5 min (e não antes)', async () => {
    const c = cenario({ janela: 5 })
    await c.atribuir('la1', T0)
    c.avancarPara(em(4 * MIN + 59_000))
    expect((await c.rodar()).enviados).toBe(0)
    c.avancarPara(em(5 * MIN))
    const r = await c.rodar()
    expect(r).toMatchObject({ vencidos: 1, enviados: 1, janelaMinutos: 5 })
    expect(c.chamadas[0].mensagem).toContain('Em contato comercial há 5 minutos.')
  })

  it('4. configuração ausente → usa 7 dias', async () => {
    const c = cenario({ janela: null })
    await c.atribuir('la1', T0)
    c.avancarPara(em(6 * DIA))
    expect((await c.rodar()).janelaMinutos).toBe(HANDOFF_REVISAO_MINUTOS_PADRAO)
    expect(c.chamadas).toHaveLength(0)
    c.avancarPara(em(7 * DIA))
    expect((await c.rodar()).enviados).toBe(1)
  })

  it('9. janela muda de 7 dias para 5 min com handoffs antigos → todos os vencidos recebem UM check-in', async () => {
    const c = cenario({ janela: 10080 })
    await c.atribuir('la1', T0)
    await c.atribuir('la2', em(1 * MIN))
    c.avancarPara(em(10 * MIN))
    expect((await c.rodar()).vencidos).toBe(0)
    c.deps.lerJanelaMinutos = async () => 5
    const r = await c.rodar()
    expect(r).toMatchObject({ vencidos: 2, enviados: 2 })
    expect((await c.rodar()).jaEnviados).toBe(2)
    expect(c.chamadas).toHaveLength(2)
  })
})

describe('acompanhamento — idempotência e concorrência', () => {
  it('5/6. check-in enviado uma vez; segundo ciclo (e o terceiro) não duplica', async () => {
    const c = cenario({ janela: 5 })
    await c.atribuir('la1', T0)
    c.avancarPara(em(6 * MIN))
    expect((await c.rodar()).enviados).toBe(1)
    expect((await c.rodar())).toMatchObject({ vencidos: 1, enviados: 0, jaEnviados: 1 })
    c.avancarPara(em(3 * DIA))
    expect((await c.rodar())).toMatchObject({ vencidos: 1, enviados: 0, jaEnviados: 1 })
    expect(c.chamadas).toHaveLength(1)
    expect(c.notif.linhas.filter((n) => n.tipo === 'handoff_checkin')).toHaveLength(1)
  })

  it('7. dois workers concorrentes (mesmo handoff vencido) → uma única chamada à Z-API', async () => {
    const c = cenario({ janela: 5 })
    await c.atribuir('la1', T0)
    c.avancarPara(em(6 * MIN))
    let chegaram = 0; let liberar!: () => void
    const barreira = new Promise<void>((res) => { liberar = res })
    c.notif.antesDeReivindicar = async () => { if (++chegaram === 2) liberar(); await barreira }
    const [a, b] = await Promise.all([c.rodar(), c.rodar()])
    expect([a.enviados + b.enviados, a.pendentes + b.pendentes]).toEqual([1, 1])
    expect(c.chamadas).toHaveLength(1)
    expect(c.notif.linhas).toHaveLength(1)
  })

  it('17. processo morreu após o envio, antes de marcar ("enviando" preso) → não reenvia', async () => {
    const c = cenario({ janela: 5 })
    await c.atribuir('la1', T0)
    c.avancarPara(em(6 * MIN))
    // Reproduz o crash: a intenção existe e foi reivindicada, mas ninguém marcou.
    const intencao = await c.notif.registrarIntencao(ORG_A, c.handoff.handoffs(ORG_A)[0].id, 'handoff_checkin', { empresa: '', contato: '', responsavelNome: 'Bruno', motivo: 'round_robin', etapaCadencia: '' })
    await c.notif.reivindicarEnvio(ORG_A, intencao.id, 0)
    const r = await c.rodar()
    expect(r.resultados[0]).toMatchObject({ tipo: 'pendente', motivo: 'incerta' })
    expect(c.chamadas).toHaveLength(0)
  })
})

describe('acompanhamento — falhas recuperáveis', () => {
  it('8. Z-API offline → check-in fica falhou/retentável; volta e envia uma única vez', async () => {
    const c = cenario({ janela: 5, envio: 'offline' })
    await c.atribuir('la1', T0)
    c.avancarPara(em(6 * MIN))
    const r = await c.rodar()
    expect(r.resultados[0]).toMatchObject({ tipo: 'pendente', motivo: 'falhou' })
    expect(c.notif.linhas[0]).toMatchObject({ tipo: 'handoff_checkin', status: 'falhou', tentativas: 1 })
    c.setEnvio('ok')
    expect((await c.rodar()).enviados).toBe(1)
    expect(c.chamadas).toHaveLength(2)
    expect(c.notif.linhas).toHaveLength(1)
    expect((await c.rodar()).jaEnviados).toBe(1)
  })

  it('9. grupo ausente → configuracao_ausente recuperável; configurado depois → envia', async () => {
    const c = cenario({ janela: 5, grupo: null })
    await c.atribuir('la1', T0)
    c.avancarPara(em(6 * MIN))
    const r = await c.rodar()
    expect(r.resultados[0]).toMatchObject({ tipo: 'pendente', motivo: 'configuracao_ausente' })
    expect(c.chamadas).toHaveLength(0)
    expect(c.notif.linhas[0]).toMatchObject({ status: 'configuracao_ausente', tentativas: 0 })
    c.setGrupo(GRUPO)
    expect((await c.rodar()).enviados).toBe(1)
    expect(c.chamadas).toHaveLength(1)
  })
})

describe('acompanhamento — quando NÃO enviar', () => {
  it('10. handoff encerrado → não envia', async () => {
    const c = cenario({ janela: 5 })
    const r = await c.atribuir('la1', T0)
    c.handoff.encerrarHandoff(r.handoff.id)
    c.avancarPara(em(10 * MIN))
    expect((await c.rodar())).toMatchObject({ vencidos: 0, enviados: 0 })
    expect(c.chamadas).toHaveLength(0)
  })

  it('11. aguardando distribuição → não envia (mesmo velho)', async () => {
    const c = cenario({ janela: 5 })
    c.handoff.participar(ORG_A, 'bruno', false).participar(ORG_A, 'silmara', false)
    c.handoff.agoraFixo = T0
    const r = await atribuirResponsavelHandoff(c.handoff, { organizacaoId: ORG_A, leadId: 'la1', eventoId: 'ev', origem: 'prospeccao' })
    c.handoff.agoraFixo = null
    expect(r.tipo).toBe('aguardando_distribuicao')
    c.avancarPara(em(10 * DIA))
    expect((await c.rodar())).toMatchObject({ vencidos: 0 })
    expect(c.chamadas).toHaveLength(0)
  })

  it('comercial removido da equipe → ignorado (mensagem seria incorreta), sem intenção', async () => {
    const c = cenario({ janela: 5 })
    await c.atribuir('la1', T0)
    c.handoff.removerUsuario('bruno') // responsavel_id vira null → não é "aberto com responsável"
    c.avancarPara(em(10 * MIN))
    expect((await c.rodar())).toMatchObject({ vencidos: 0 })
    expect(c.notif.linhas).toHaveLength(0)
  })

  it('13. organização A não vê nem processa handoffs da B', async () => {
    const c = cenario({ janela: 5 })
    await c.atribuir('lb1', T0, ORG_B)
    c.avancarPara(em(10 * MIN))
    expect((await c.rodar(ORG_A))).toMatchObject({ vencidos: 0, enviados: 0 })
    expect(c.chamadas).toHaveLength(0)
    const rb = await c.rodar(ORG_B)
    expect(rb.enviados).toBe(1)
    expect(c.chamadas[0].mensagem).toContain('@Ana, como ficou o lead Org B Ltda?')
    expect(c.notif.linhas[0].organizacaoId).toBe(ORG_B)
  })
})

describe('acompanhamento — não altera nada no handoff', () => {
  it('14/15/16. responsável, cursor, status/encerramento do handoff e ownership do lead ficam iguais', async () => {
    const c = cenario({ janela: 5 })
    await c.atribuir('la1', T0)          // Bruno
    await c.atribuir('la2', em(1 * MIN)) // Silmara
    const antes = { cursor: c.handoff.cursor(ORG_A), handoffs: c.handoff.handoffs(ORG_A), la1: c.handoff.lead('la1'), la2: c.handoff.lead('la2') }
    c.avancarPara(em(10 * MIN))
    expect((await c.rodar()).enviados).toBe(2)
    expect(c.handoff.cursor(ORG_A)).toEqual(antes.cursor)
    expect(c.handoff.handoffs(ORG_A)).toEqual(antes.handoffs)
    expect(c.handoff.lead('la1')).toEqual(antes.la1)
    expect(c.handoff.lead('la2')).toEqual(antes.la2)
    expect(c.handoff.handoffs(ORG_A).every((h) => h.status === 'em_contato_comercial' && h.encerradoEm === null)).toBe(true)
    // Próximo handoff novo continua o rodízio de onde estava (Bruno de novo).
    c.handoff.addLead({ id: 'la3', organizacaoId: ORG_A })
    const r = await c.atribuir('la3', em(11 * MIN))
    expect(r.responsavel.id).toBe('bruno')
  })

  it('12. reativação: check-in usa o MESMO responsável e o relógio do novo handoff', async () => {
    const c = cenario({ janela: 5 })
    const primeiro = await c.atribuir('la1', T0) // Bruno
    c.handoff.encerrarHandoff(primeiro.handoff.id)
    c.handoff.participar(ORG_A, 'bruno', false) // Bruno fora do rodízio, mas é o dono
    const re = await c.atribuir('la1', em(30 * MIN), ORG_A, 'ev-reativacao')
    expect(re.motivo).toBe('reativacao')
    c.avancarPara(em(33 * MIN)) // 3 min após a reativação: ainda não
    expect((await c.rodar()).vencidos).toBe(0)
    c.avancarPara(em(36 * MIN)) // 6 min após a reativação
    const r = await c.rodar()
    expect(r.enviados).toBe(1)
    expect(c.chamadas[0].mensagem).toContain('@Bruno, como ficou o lead Metalúrgica ABC?')
    expect(c.chamadas[0].mensagem).toContain('Em contato comercial há 6 minutos.')
  })

  it('lead sem empresa usa o contato; nada é inventado', async () => {
    const c = cenario({ janela: 5 })
    await c.atribuir('la2', T0)
    c.avancarPara(em(6 * MIN))
    await c.rodar()
    expect(c.chamadas[0].mensagem).toContain('@Bruno, como ficou o lead Maria?')
    expect(c.chamadas[0].mensagem).toContain('Contato: Maria')
  })
})

describe('mensagem e tempo', () => {
  it('descreverTempoDecorrido', () => {
    expect(descreverTempoDecorrido(T0, em(30_000))).toBe('menos de 1 minuto')
    expect(descreverTempoDecorrido(T0, em(1 * MIN))).toBe('1 minuto')
    expect(descreverTempoDecorrido(T0, em(5 * MIN))).toBe('5 minutos')
    expect(descreverTempoDecorrido(T0, em(3 * 60 * MIN))).toBe('3 horas')
    expect(descreverTempoDecorrido(T0, em(7 * DIA + 5 * 60 * MIN))).toBe('7 dias')
    expect(descreverTempoDecorrido(em(60_000), T0)).toBe('menos de 1 minuto') // nunca negativo
  })

  it('montarMensagemCheckin cobre os campos e o fallback sem identificação', () => {
    const m = montarMensagemCheckin({ empresa: '', contato: '', responsavelNome: 'Bruno', motivo: 'round_robin', etapaCadencia: '' })
    expect(m).toContain('como ficou o lead sem identificação?')
    expect(m).toContain('Contato: não informado')
    expect(m).toContain('Em contato comercial há algum tempo.')
  })
})
