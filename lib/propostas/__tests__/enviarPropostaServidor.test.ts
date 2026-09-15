import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { enviarProposta, type DepsEnvioProposta } from '../enviarPropostaServidor'

// Nada aqui toca rede nem banco: `db` é um fake que registra cada consulta e
// os canais chegam por `deps`. Prova as travas, os dois caminhos (ensaio e
// envio real) e o escopo de organização em toda leitura e escrita.

const ORG = 'org-A'
const OUTRA = 'org-B'
const PDF = new Uint8Array([37, 80, 68, 70])
const AGORA = new Date('2026-09-14T15:00:00Z')
const PROPOSTA = { id: 'P1', lead_id: 'L1', dados_pdf: { modalidade: 'comodato' } }
const LEAD = {
  id: 'L1', empresa: 'iNOVACODE', contato_email: 'cliente@acme.com', contato_telefone: '(11) 99999-8888',
  optout: false, bounced: false, perdido: false, responsavel_id: 'U1',
}

type Filtro = ['eq' | 'or', string, unknown]
interface Consulta { tabela: string; op: 'select' | 'update' | 'insert'; payload?: Record<string, unknown>; filtros: Filtro[] }

interface OpcoesDb {
  proposta?: unknown
  lead?: unknown
  trava?: Array<{ id: string; envios: number | null }>
  erroMarcarEnviada?: string
  erroInteracao?: string
}

function dbFake(o: OpcoesDb = {}) {
  const consultas: Consulta[] = []
  const responder = (c: Consulta): { data: unknown; error: { message: string } | null } => {
    if (c.op === 'select' && c.tabela === 'propostas_comerciais') return { data: 'proposta' in o ? o.proposta : PROPOSTA, error: null }
    if (c.op === 'select' && c.tabela === 'leads') return { data: 'lead' in o ? o.lead : LEAD, error: null }
    if (c.op === 'update' && c.tabela === 'propostas_comerciais') {
      if (c.payload?.status === 'enviada') {
        return o.erroMarcarEnviada
          ? { data: null, error: { message: o.erroMarcarEnviada } }
          : { data: { id: 'P1', ...c.payload }, error: null }
      }
      if (c.payload?.envio_iniciado_em) return { data: o.trava ?? [{ id: 'P1', envios: 0 }], error: null }
      return { data: null, error: null } // libera a trava
    }
    if (c.op === 'insert' && c.tabela === 'interacoes') {
      return { data: null, error: o.erroInteracao ? { message: o.erroInteracao } : null }
    }
    if (c.op === 'update' && c.tabela === 'leads') return { data: null, error: null }
    throw new Error(`consulta inesperada: ${c.op} ${c.tabela}`)
  }
  const client = {
    from(tabela: string) {
      const c: Consulta = { tabela, op: 'select', filtros: [] }
      consultas.push(c)
      const q = {
        select: () => q,
        update: (p: Record<string, unknown>) => { c.op = 'update'; c.payload = p; return q },
        insert: (p: Record<string, unknown>) => { c.op = 'insert'; c.payload = p; return q },
        eq: (col: string, v: unknown) => { c.filtros.push(['eq', col, v]); return q },
        or: (expr: string) => { c.filtros.push(['or', expr, null]); return q },
        maybeSingle: () => q,
        then: (resolver: (v: unknown) => unknown, rejeitar?: (e: unknown) => unknown) =>
          new Promise((res) => res(responder(c))).then(resolver, rejeitar),
      }
      return q
    },
  } as unknown as SupabaseClient
  return { client, consultas, escritas: () => consultas.filter((c) => c.op !== 'select') }
}

type EntradaEmail = Parameters<DepsEnvioProposta['enviarEmail']>[0]
type EntradaWhatsapp = Parameters<DepsEnvioProposta['enviarWhatsapp']>[0]

function depsFake(o: {
  ensaio?: boolean
  email?: (e: EntradaEmail) => ReturnType<DepsEnvioProposta['enviarEmail']>
  whatsapp?: (e: EntradaWhatsapp) => ReturnType<DepsEnvioProposta['enviarWhatsapp']>
  pdfFalha?: boolean
} = {}) {
  const enviarEmail = vi.fn(o.email ?? (async (_e: EntradaEmail) => ({ ok: true as const })))
  const enviarWhatsapp = vi.fn(o.whatsapp ?? (async (_e: EntradaWhatsapp) => ({ ok: true as const, registrada: true })))
  const gerarPdf = vi.fn(async () => {
    if (o.pdfFalha) throw new Error('imagem-base ausente')
    return PDF
  })
  const deps: DepsEnvioProposta = {
    agora: () => AGORA,
    modoEnsaioEmail: () => o.ensaio ?? false,
    gerarPdf,
    enviarEmail,
    enviarWhatsapp,
  }
  return { deps, enviarEmail, enviarWhatsapp, gerarPdf }
}

const EMAIL = { propostaId: 'P1', organizacaoId: ORG, canal: 'email', assunto: 'Proposta comercial — iNOVACODE', mensagem: 'Olá! Segue a proposta.' }
const WHATSAPP = { propostaId: 'P1', organizacaoId: ORG, canal: 'whatsapp', mensagem: 'Olá! Segue a proposta.' }

describe('enviarProposta — entrada', () => {
  it('canal inválido, mensagem vazia/longa e assunto vazio não tocam banco nem canal', async () => {
    const casos: Array<[Record<string, unknown>, string]> = [
      [{ ...EMAIL, canal: 'sms' }, 'canal_invalido'],
      [{ ...EMAIL, mensagem: '   ' }, 'mensagem_vazia'],
      [{ ...EMAIL, mensagem: 'x'.repeat(4001) }, 'mensagem_longa'],
      [{ ...EMAIL, assunto: '' }, 'assunto_vazio'],
    ]
    for (const [entrada, codigo] of casos) {
      const db = dbFake()
      const d = depsFake()
      const r = await enviarProposta(db.client, entrada as typeof EMAIL, d.deps)
      expect(r).toMatchObject({ ok: false, codigo })
      expect(db.consultas).toHaveLength(0)
      expect(d.enviarEmail).not.toHaveBeenCalled()
    }
  })

  it('WhatsApp não exige assunto', async () => {
    const r = await enviarProposta(dbFake().client, WHATSAPP, depsFake().deps)
    expect(r).toMatchObject({ ok: true, canal: 'whatsapp' })
  })
})

describe('enviarProposta — isolamento e travas do lead', () => {
  it('proposta de outra organização → não encontrada; leitura filtrada pela org da sessão; nada gerado nem enviado', async () => {
    const db = dbFake({ proposta: null })
    const d = depsFake()
    const r = await enviarProposta(db.client, EMAIL, d.deps)
    expect(r).toMatchObject({ ok: false, codigo: 'proposta_nao_encontrada' })
    expect(db.consultas[0].filtros).toEqual(expect.arrayContaining([['eq', 'id', 'P1'], ['eq', 'organizacao_id', ORG]]))
    expect(db.escritas()).toHaveLength(0)
    expect(d.gerarPdf).not.toHaveBeenCalled()
  })

  it('lead lido pela org da sessão; ausente → lead_nao_encontrado', async () => {
    const db = dbFake({ lead: null })
    const r = await enviarProposta(db.client, EMAIL, depsFake().deps)
    expect(r).toMatchObject({ ok: false, codigo: 'lead_nao_encontrado' })
    const leitura = db.consultas.find((c) => c.tabela === 'leads')!
    expect(leitura.filtros).toEqual(expect.arrayContaining([['eq', 'id', 'L1'], ['eq', 'organizacao_id', ORG]]))
  })

  it('opt-out e perdido bloqueiam os dois canais', async () => {
    for (const flag of ['optout', 'perdido'] as const) {
      for (const entrada of [EMAIL, WHATSAPP]) {
        const db = dbFake({ lead: { ...LEAD, [flag]: true } })
        const d = depsFake()
        expect(await enviarProposta(db.client, entrada, d.deps)).toMatchObject({ ok: false, codigo: flag })
        expect(db.escritas()).toHaveLength(0)
        expect(d.enviarEmail).not.toHaveBeenCalled()
        expect(d.enviarWhatsapp).not.toHaveBeenCalled()
      }
    }
  })

  it('bounce bloqueia só o e-mail', async () => {
    const lead = { ...LEAD, bounced: true }
    expect(await enviarProposta(dbFake({ lead }).client, EMAIL, depsFake().deps)).toMatchObject({ ok: false, codigo: 'bounced' })
    expect(await enviarProposta(dbFake({ lead }).client, WHATSAPP, depsFake().deps)).toMatchObject({ ok: true })
  })

  it('sem e-mail / sem telefone utilizável', async () => {
    expect(await enviarProposta(dbFake({ lead: { ...LEAD, contato_email: ' ' } }).client, EMAIL, depsFake().deps))
      .toMatchObject({ ok: false, codigo: 'sem_email' })
    expect(await enviarProposta(dbFake({ lead: { ...LEAD, contato_telefone: '123' } }).client, WHATSAPP, depsFake().deps))
      .toMatchObject({ ok: false, codigo: 'sem_telefone' })
  })
})

describe('enviarProposta — MODO_ENSAIO', () => {
  it('e-mail em ensaio: gera o PDF, NÃO envia e NÃO grava nada', async () => {
    const db = dbFake()
    const d = depsFake({ ensaio: true })
    const r = await enviarProposta(db.client, EMAIL, d.deps)
    expect(r).toEqual({ ok: true, simulado: true, motivo: 'modo_ensaio', canal: 'email', destino: 'cliente@acme.com' })
    expect(d.gerarPdf).toHaveBeenCalledTimes(1)
    expect(d.enviarEmail).not.toHaveBeenCalled()
    expect(db.escritas()).toHaveLength(0)
  })
})

describe('enviarProposta — envio real', () => {
  it('e-mail: trava → envia com o PDF anexo → marca enviada → registra interação e último contato', async () => {
    const db = dbFake()
    const d = depsFake()
    const r = await enviarProposta(db.client, EMAIL, d.deps)
    expect(r).toMatchObject({ ok: true, simulado: false, canal: 'email', destino: 'cliente@acme.com', registrada: true })

    expect(d.enviarEmail).toHaveBeenCalledTimes(1)
    expect(d.enviarEmail.mock.calls[0][0]).toEqual({
      organizacaoId: ORG,
      para: 'cliente@acme.com',
      assunto: EMAIL.assunto,
      texto: EMAIL.mensagem,
      responsavelId: 'U1',
      anexo: { nomeArquivo: 'proposta-inovacode-2026-09-14.pdf', conteudo: PDF, tipo: 'application/pdf' },
    })

    const [trava, marcar, interacao, contato] = db.escritas()
    expect(trava).toMatchObject({ tabela: 'propostas_comerciais', op: 'update', payload: { envio_iniciado_em: AGORA.toISOString() } })
    expect(String(trava.filtros.find((f) => f[0] === 'or')?.[1])).toContain('envio_iniciado_em.is.null')
    expect(marcar.payload).toEqual({
      status: 'enviada', enviada_em: AGORA.toISOString(), enviada_canal: 'email',
      enviada_para: 'cliente@acme.com', envios: 1, envio_iniciado_em: null,
    })
    expect(interacao).toMatchObject({
      tabela: 'interacoes', op: 'insert',
      payload: { organizacao_id: ORG, lead_id: 'L1', tipo: 'nota', canal: 'email', origem_acao: 'humano', responsavel_id: 'U1' },
    })
    expect(String(interacao.payload?.descricao)).toMatch(/^Proposta comercial enviada por e-mail/)
    expect(contato).toMatchObject({ tabela: 'leads', op: 'update', payload: { ultimo_contato: AGORA.toISOString() } })
  })

  it('reenvio soma ao contador de envios lido na trava', async () => {
    const db = dbFake({ trava: [{ id: 'P1', envios: 2 }] })
    await enviarProposta(db.client, EMAIL, depsFake().deps)
    expect(db.escritas()[1].payload).toMatchObject({ status: 'enviada', envios: 3 })
  })

  it('WhatsApp: envia o documento com a mensagem de legenda e não grava em interacoes', async () => {
    const db = dbFake()
    const d = depsFake()
    const r = await enviarProposta(db.client, WHATSAPP, d.deps)
    expect(r).toMatchObject({ ok: true, simulado: false, canal: 'whatsapp', destino: '5511999998888', registrada: true })
    expect(d.enviarWhatsapp.mock.calls[0][0]).toEqual({
      organizacaoId: ORG, leadId: 'L1', pdf: PDF, nomeArquivo: 'proposta-inovacode-2026-09-14.pdf', legenda: WHATSAPP.mensagem,
    })
    expect(db.escritas().map((c) => c.tabela)).toEqual(['propostas_comerciais', 'propostas_comerciais'])
  })

  it('WhatsApp aceito sem registro local → registrada=false', async () => {
    const d = depsFake({ whatsapp: async () => ({ ok: true, registrada: false }) })
    const r = await enviarProposta(dbFake().client, WHATSAPP, d.deps)
    expect(r).toMatchObject({ ok: true, registrada: false })
  })

  it('WhatsApp não usa a trava de ensaio do e-mail', async () => {
    const d = depsFake({ ensaio: true })
    const r = await enviarProposta(dbFake().client, WHATSAPP, d.deps)
    expect(r).toMatchObject({ ok: true, simulado: false })
    expect(d.enviarWhatsapp).toHaveBeenCalledTimes(1)
  })

  it('envio em andamento (trava ocupada) → erro sem chamar o canal', async () => {
    const db = dbFake({ trava: [] })
    const d = depsFake()
    const r = await enviarProposta(db.client, EMAIL, d.deps)
    expect(r).toMatchObject({ ok: false, codigo: 'envio_em_andamento' })
    expect(d.enviarEmail).not.toHaveBeenCalled()
    expect(db.escritas()).toHaveLength(1)
  })

  it('falha do provedor → libera a trava; não marca enviada nem registra', async () => {
    const db = dbFake()
    const d = depsFake({ email: async () => ({ ok: false, codigo: 'falha_envio', mensagem: 'SMTP 535' }) })
    const r = await enviarProposta(db.client, EMAIL, d.deps)
    expect(r).toEqual({ ok: false, codigo: 'falha_envio', mensagem: 'SMTP 535' })
    const escritas = db.escritas()
    expect(escritas).toHaveLength(2)
    expect(escritas[1].payload).toEqual({ envio_iniciado_em: null })
    expect(escritas[1].filtros).toEqual(expect.arrayContaining([['eq', 'id', 'P1'], ['eq', 'organizacao_id', ORG]]))
  })

  it('canal que lança exceção também libera a trava', async () => {
    const db = dbFake()
    const d = depsFake({ email: async () => { throw new Error('ECONNRESET') } })
    const r = await enviarProposta(db.client, EMAIL, d.deps)
    expect(r).toMatchObject({ ok: false, codigo: 'falha_envio' })
    expect(db.escritas()[1].payload).toEqual({ envio_iniciado_em: null })
  })

  it('cliente recebeu mas marcar como enviada falhou → ok com registrada=false, sem reenviar', async () => {
    const db = dbFake({ erroMarcarEnviada: 'timeout' })
    const d = depsFake()
    const r = await enviarProposta(db.client, EMAIL, d.deps)
    expect(r).toMatchObject({ ok: true, simulado: false, registrada: false, proposta: null })
    expect(d.enviarEmail).toHaveBeenCalledTimes(1)
  })

  it('falha ao registrar a interação → registrada=false; último contato não é tocado', async () => {
    const db = dbFake({ erroInteracao: 'rls' })
    const r = await enviarProposta(db.client, EMAIL, depsFake().deps)
    expect(r).toMatchObject({ ok: true, registrada: false })
    expect(db.escritas().some((c) => c.tabela === 'leads')).toBe(false)
  })

  it('falha ao gerar o PDF → falha_pdf antes de qualquer trava ou envio', async () => {
    const db = dbFake()
    const d = depsFake({ pdfFalha: true })
    const r = await enviarProposta(db.client, EMAIL, d.deps)
    expect(r).toMatchObject({ ok: false, codigo: 'falha_pdf' })
    expect(db.escritas()).toHaveLength(0)
    expect(d.enviarEmail).not.toHaveBeenCalled()
  })

  it('NUNCA toca organizacao_id de outro tenant', async () => {
    for (const entrada of [EMAIL, WHATSAPP]) {
      const db = dbFake()
      await enviarProposta(db.client, entrada, depsFake().deps)
      for (const c of db.consultas) {
        const orgs = c.filtros.filter((f) => f[0] === 'eq' && f[1] === 'organizacao_id').map((f) => f[2])
        if (c.op === 'insert') expect(c.payload?.organizacao_id).toBe(ORG)
        else expect(orgs).toEqual([ORG])
        expect(JSON.stringify(c)).not.toContain(OUTRA)
      }
    }
  })
})
