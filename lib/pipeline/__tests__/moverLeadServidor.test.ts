import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { moverLead, previaMover, type DepsMoverLead } from '../moverLeadServidor'

// Nada aqui toca rede nem banco: `db` é um fake que registra cada consulta e
// os canais chegam por `deps`. Prova as travas, os dois caminhos (ensaio e
// envio real), a ordem mover→enviar→desfazer e o escopo de organização.

const ORG = 'org-A'
const AGORA = new Date('2026-09-25T15:00:00Z')
const LEAD = {
  id: 'L1', organizacao_id: ORG, estagio: 'respondeu', empresa: 'Hotel Sol', contato_nome: 'Ana Lima',
  contato_email: 'ana@hotelsol.com.br', contato_telefone: '(11) 99999-8888', segmento: 'Hotelaria',
  optout: false, bounced: false, perdido: false, responsavel_id: 'U1',
}
const TEMPLATE_EMAIL = {
  id: 'T1', nome: 'Confirmação de reunião', nicho: null, created_at: '2026-09-01',
  assunto: 'Reunião {{data_reuniao}}', corpo: 'Olá {{nome}}, confirmado {{data_reuniao}} às {{hora_reuniao}}.', html: null,
}
const TEMPLATE_WHATSAPP = { ...TEMPLATE_EMAIL, id: 'T2', assunto: null }
const ATOR = { usuarioId: 'U9', nome: 'Lucas' }
const REUNIAO = { data: '2026-09-30', hora: '14:00' }

type Filtro = [string, unknown]
interface Consulta { tabela: string; op: 'select' | 'update' | 'insert'; payload?: unknown; filtros: Filtro[] }

interface OpcoesDb {
  lead?: unknown
  templates?: unknown[]
  moverAfeta?: number // linhas afetadas pela troca de etapa condicional
  erroHistorico?: string
}

function dbFake(o: OpcoesDb = {}) {
  const consultas: Consulta[] = []
  const responder = (c: Consulta): { data: unknown; error: { message: string } | null } => {
    if (c.op === 'select' && c.tabela === 'leads') return { data: 'lead' in o ? o.lead : LEAD, error: null }
    if (c.op === 'select' && c.tabela === 'templates') {
      const canal = c.filtros.find(([k]) => k === 'canal')?.[1]
      const padrao = canal === 'whatsapp' ? [TEMPLATE_WHATSAPP] : [TEMPLATE_EMAIL]
      return { data: o.templates ?? padrao, error: null }
    }
    if (c.op === 'select' && c.tabela === 'organizacoes') {
      return { data: { nome: 'Org A', configuracoes: { nomenclaturas: { nome_servico: 'Laudo' } } }, error: null }
    }
    if (c.op === 'select' && c.tabela === 'usuarios') return { data: { nome: 'Carla' }, error: null }
    if (c.op === 'update' && c.tabela === 'leads') {
      const payload = c.payload as Record<string, unknown>
      if ('estagio' in payload && c.filtros.some(([k]) => k === 'estagio') && payload.estagio !== LEAD.estagio) {
        return { data: Array.from({ length: o.moverAfeta ?? 1 }, () => ({ id: 'L1' })), error: null }
      }
      return { data: null, error: null }
    }
    if (c.op === 'insert' && c.tabela === 'interacoes') {
      return { data: null, error: o.erroHistorico ? { message: o.erroHistorico } : null }
    }
    throw new Error(`consulta inesperada: ${c.op} ${c.tabela}`)
  }
  const client = {
    from(tabela: string) {
      const c: Consulta = { tabela, op: 'select', filtros: [] }
      consultas.push(c)
      const q = {
        select: () => q,
        update: (p: unknown) => { c.op = 'update'; c.payload = p; return q },
        insert: (p: unknown) => { c.op = 'insert'; c.payload = p; return q },
        eq: (col: string, v: unknown) => { c.filtros.push([col, v]); return q },
        maybeSingle: () => q,
        then: (resolver: (v: unknown) => unknown, rejeitar?: (e: unknown) => unknown) =>
          new Promise((res) => res(responder(c))).then(resolver, rejeitar),
      }
      return q
    },
  } as unknown as SupabaseClient
  return {
    client,
    consultas,
    escritas: () => consultas.filter((c) => c.op !== 'select'),
    historico: () => consultas.filter((c) => c.op === 'insert').flatMap((c) => c.payload as Record<string, unknown>[]),
  }
}

type EntradaEmail = Parameters<DepsMoverLead['enviarEmail']>[0]
type EntradaWhatsapp = Parameters<DepsMoverLead['enviarWhatsapp']>[0]

function depsFake(o: {
  ensaio?: boolean
  email?: (e: EntradaEmail) => ReturnType<DepsMoverLead['enviarEmail']>
  whatsapp?: (e: EntradaWhatsapp) => ReturnType<DepsMoverLead['enviarWhatsapp']>
} = {}) {
  const enviarEmail = vi.fn(o.email ?? (async (_e: EntradaEmail) => ({ ok: true as const })))
  const enviarWhatsapp = vi.fn(o.whatsapp ?? (async (_e: EntradaWhatsapp) => ({ ok: true as const, registrada: true })))
  const deps: DepsMoverLead = { agora: () => AGORA, modoEnsaio: () => o.ensaio ?? false, enviarEmail, enviarWhatsapp }
  return { deps, enviarEmail, enviarWhatsapp }
}

const entrada = (p: Record<string, unknown> = {}) => ({ leadId: 'L1', organizacaoId: ORG, de: 'respondeu', para: 'ganho', ...p })

// Toda consulta (leitura e escrita) filtra pela organização, exceto a leitura
// da própria organização, que filtra pelo id dela.
function tudoNaOrganizacao(consultas: Consulta[]) {
  for (const c of consultas) {
    if (c.op === 'insert') {
      for (const linha of c.payload as Record<string, unknown>[]) expect(linha.organizacao_id).toBe(ORG)
      continue
    }
    const chave = c.tabela === 'organizacoes' ? 'id' : 'organizacao_id'
    expect(c.filtros).toContainEqual([chave, ORG])
  }
}

describe('moverLead — entrada', () => {
  it('etapa de destino fora do Kanban e reunião sem data não tocam banco', async () => {
    for (const [e, codigo] of [
      [entrada({ para: 'novos_leads' }), 'etapa_invalida'],
      [entrada({ para: 'reuniao_agendada' }), 'reuniao_invalida'],
      [entrada({ para: 'reuniao_agendada', reuniao: { data: '2026-02-30', hora: '10:00' } }), 'reuniao_invalida'],
      [entrada({ canal: 'sms' }), 'canal_invalido'],
    ] as const) {
      const db = dbFake()
      expect(await moverLead(db.client, e, ATOR, depsFake().deps)).toMatchObject({ ok: false, codigo })
      expect(db.consultas).toHaveLength(0)
    }
  })

  it('lead de outra organização não é encontrado', async () => {
    const db = dbFake({ lead: null })
    expect(await moverLead(db.client, entrada(), ATOR, depsFake().deps)).toMatchObject({ ok: false, codigo: 'lead_nao_encontrado' })
    expect(db.escritas()).toHaveLength(0)
    tudoNaOrganizacao(db.consultas)
  })

  it('mesma coluna e etapa que mudou desde a tela são recusadas sem escrever', async () => {
    const mesma = dbFake({ lead: { ...LEAD, estagio: 'interessado' } })
    expect(await moverLead(mesma.client, entrada({ de: 'interessado', para: 'respondeu' }), ATOR, depsFake().deps))
      .toMatchObject({ ok: false, codigo: 'ja_na_etapa' })
    const mudou = dbFake()
    expect(await moverLead(mudou.client, entrada({ de: 'com_closer' }), ATOR, depsFake().deps))
      .toMatchObject({ ok: false, codigo: 'etapa_mudou' })
    expect([...mesma.escritas(), ...mudou.escritas()]).toHaveLength(0)
  })
})

describe('moverLead — apenas mover', () => {
  it('troca a etapa condicionada à de origem e registra nota com o autor', async () => {
    const db = dbFake()
    const d = depsFake()
    const r = await moverLead(db.client, entrada(), ATOR, d.deps)
    expect(r).toEqual({ ok: true, simulado: false, estagio: 'ganho', enviado: null, registrada: true })
    const [mover, historico] = db.escritas()
    expect(mover).toMatchObject({ tabela: 'leads', op: 'update', payload: { estagio: 'ganho' } })
    expect(mover.filtros).toContainEqual(['estagio', 'respondeu'])
    expect(db.historico()).toEqual([expect.objectContaining({
      tipo: 'nota', canal: 'plataforma', origem_acao: 'humano', responsavel_id: 'U9', motivo: 'kanban_mover',
      descricao: 'Movido de Respondeu para Ganho por Lucas (Kanban).',
    })])
    expect(historico.tabela).toBe('interacoes')
    expect(d.enviarEmail).not.toHaveBeenCalled()
    expect(d.enviarWhatsapp).not.toHaveBeenCalled()
    tudoNaOrganizacao(db.consultas)
  })

  it('Reunião Agendada vira interação de reunião com data e hora', async () => {
    const db = dbFake()
    await moverLead(db.client, entrada({ para: 'reuniao_agendada', reuniao: REUNIAO }), ATOR, depsFake().deps)
    expect(db.historico()[0]).toMatchObject({
      tipo: 'reuniao',
      descricao: 'Movido de Respondeu para Reunião Agendada por Lucas (Kanban).\nReunião agendada para 30/09/2026 às 14:00.',
    })
  })

  it('outra pessoa moveu antes (0 linhas): recusa e não registra nada', async () => {
    const db = dbFake({ moverAfeta: 0 })
    expect(await moverLead(db.client, entrada(), ATOR, depsFake().deps)).toMatchObject({ ok: false, codigo: 'etapa_mudou' })
    expect(db.historico()).toHaveLength(0)
  })

  it('não exige mensagem nem contato: opt-out pode ser movido', async () => {
    const db = dbFake({ lead: { ...LEAD, optout: true, contato_email: null } })
    expect(await moverLead(db.client, entrada(), ATOR, depsFake().deps)).toMatchObject({ ok: true, enviado: null })
  })
})

describe('moverLead — mover e enviar', () => {
  const reuniaoEmail = entrada({ para: 'reuniao_agendada', reuniao: REUNIAO, canal: 'email' })

  it('travas do lead e do template bloqueiam antes de mover ou enviar', async () => {
    const casos: Array<[OpcoesDb, Record<string, unknown>, string]> = [
      [{ lead: { ...LEAD, optout: true } }, {}, 'optout'],
      [{ lead: { ...LEAD, perdido: true } }, {}, 'perdido'],
      [{ lead: { ...LEAD, bounced: true } }, {}, 'bounced'],
      [{ lead: { ...LEAD, contato_email: '  ' } }, {}, 'sem_email'],
      [{ lead: { ...LEAD, contato_telefone: '123' } }, { canal: 'whatsapp' }, 'sem_telefone'],
      [{ templates: [] }, {}, 'sem_template'],
      [{ templates: [{ ...TEMPLATE_EMAIL, corpo: 'Cupom {{cupom}}' }] }, {}, 'variaveis_pendentes'],
    ]
    for (const [opcoes, extra, codigo] of casos) {
      const db = dbFake(opcoes)
      const d = depsFake()
      const r = await moverLead(db.client, { ...reuniaoEmail, ...extra }, ATOR, d.deps)
      expect(r).toMatchObject({ ok: false, codigo })
      expect(db.escritas()).toHaveLength(0)
      expect(d.enviarEmail).not.toHaveBeenCalled()
      expect(d.enviarWhatsapp).not.toHaveBeenCalled()
    }
  })

  it('bounce não impede WhatsApp', async () => {
    const db = dbFake({ lead: { ...LEAD, bounced: true } })
    expect(await moverLead(db.client, { ...reuniaoEmail, canal: 'whatsapp' }, ATOR, depsFake().deps)).toMatchObject({ ok: true })
  })

  it('ensaio: nada enviado, movido ou gravado', async () => {
    const db = dbFake()
    const d = depsFake({ ensaio: true })
    const r = await moverLead(db.client, reuniaoEmail, ATOR, d.deps)
    expect(r).toEqual({ ok: true, simulado: true, canal: 'email', destino: 'ana@hotelsol.com.br' })
    expect(db.escritas()).toHaveLength(0)
    expect(d.enviarEmail).not.toHaveBeenCalled()
  })

  it('e-mail: move, envia com a reunião preenchida e registra no histórico', async () => {
    const db = dbFake()
    const ordem: string[] = []
    const d = depsFake({
      email: async () => { ordem.push(`enviar após ${db.escritas().length} escrita(s)`); return { ok: true } },
    })
    const r = await moverLead(db.client, reuniaoEmail, ATOR, d.deps)
    expect(r).toEqual({
      ok: true, simulado: false, estagio: 'reuniao_agendada',
      enviado: { canal: 'email', destino: 'ana@hotelsol.com.br' }, registrada: true,
    })
    expect(ordem).toEqual(['enviar após 1 escrita(s)']) // a troca de etapa vem antes do envio
    expect(d.enviarEmail).toHaveBeenCalledWith(expect.objectContaining({
      organizacaoId: ORG, para: 'ana@hotelsol.com.br', assunto: 'Reunião 30/09/2026',
      texto: 'Olá Ana, confirmado 30/09/2026 às 14:00.',
    }))
    expect(d.enviarEmail.mock.calls[0][0].html).toContain('Carla') // assinatura do responsável
    const [movimento, email] = db.historico()
    expect(movimento).toMatchObject({ tipo: 'reuniao', canal: 'plataforma' })
    expect(String(movimento.descricao)).toContain('Mensagem da etapa enviada por e-mail (template "Confirmação de reunião").')
    expect(email).toMatchObject({ tipo: 'nota', canal: 'email', template_id: 'T1' })
    expect(db.escritas().at(-1)).toMatchObject({ tabela: 'leads', payload: { ultimo_contato: AGORA.toISOString() } })
    tudoNaOrganizacao(db.consultas)
  })

  it('falha no envio: a etapa volta à de origem e nada vai ao histórico', async () => {
    const db = dbFake()
    const d = depsFake({ email: async () => ({ ok: false, codigo: 'credencial_ausente', mensagem: 'sem conta' }) })
    const r = await moverLead(db.client, reuniaoEmail, ATOR, d.deps)
    expect(r).toEqual({ ok: false, codigo: 'credencial_ausente', mensagem: 'sem conta' })
    const [mover, voltar] = db.escritas()
    expect(mover.payload).toEqual({ estagio: 'reuniao_agendada' })
    expect(voltar.payload).toEqual({ estagio: 'respondeu' })
    expect(voltar.filtros).toContainEqual(['estagio', 'reuniao_agendada'])
    expect(db.historico()).toHaveLength(0)
  })

  it('exceção do provedor também desfaz a troca de etapa', async () => {
    const db = dbFake()
    const d = depsFake({ whatsapp: async () => { throw new Error('rede') } })
    const r = await moverLead(db.client, { ...reuniaoEmail, canal: 'whatsapp' }, ATOR, d.deps)
    expect(r).toMatchObject({ ok: false, codigo: 'falha_envio' })
    expect(db.escritas().map((c) => (c.payload as Record<string, unknown>).estagio)).toEqual(['reuniao_agendada', 'respondeu'])
  })

  it('WhatsApp: uma interação só (a mensagem fica em whatsapp_mensagens); registro falho vira registrada=false', async () => {
    const db = dbFake()
    const d = depsFake({ whatsapp: async () => ({ ok: true, registrada: false }) })
    const r = await moverLead(db.client, { ...reuniaoEmail, canal: 'whatsapp' }, ATOR, d.deps)
    expect(r).toMatchObject({ ok: true, enviado: { canal: 'whatsapp', destino: '5511999998888' }, registrada: false })
    expect(d.enviarWhatsapp).toHaveBeenCalledWith({ organizacaoId: ORG, leadId: 'L1', texto: 'Olá Ana, confirmado 30/09/2026 às 14:00.' })
    expect(db.historico()).toHaveLength(1)
  })

  it('histórico que falha depois do envio não vira erro (não reenviar)', async () => {
    const db = dbFake({ erroHistorico: 'timeout' })
    const r = await moverLead(db.client, reuniaoEmail, ATOR, depsFake().deps)
    expect(r).toMatchObject({ ok: true, registrada: false })
  })
})

describe('previaMover', () => {
  it('monta a mensagem final sem escrever nada e informa o ensaio', async () => {
    const db = dbFake()
    const r = await previaMover(db.client, entrada({ para: 'reuniao_agendada', reuniao: REUNIAO, canal: 'email' }), { modoEnsaio: () => true })
    expect(r).toMatchObject({
      ok: true, modoEnsaio: true,
      envio: { canal: 'email', destino: 'ana@hotelsol.com.br', templateNome: 'Confirmação de reunião', assunto: 'Reunião 30/09/2026' },
    })
    if (r.ok) expect(r.envio.html).toContain('confirmado 30/09/2026')
    expect(db.escritas()).toHaveLength(0)
    tudoNaOrganizacao(db.consultas)
  })

  it('exige canal e devolve as mesmas travas do envio', async () => {
    expect(await previaMover(dbFake().client, entrada(), { modoEnsaio: () => false })).toMatchObject({ ok: false, codigo: 'canal_invalido' })
    expect(await previaMover(dbFake({ templates: [] }).client, entrada({ canal: 'whatsapp' }), { modoEnsaio: () => false }))
      .toMatchObject({ ok: false, codigo: 'sem_template' })
  })
})
