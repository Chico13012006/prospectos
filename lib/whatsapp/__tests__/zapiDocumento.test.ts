import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendDocumentPdf, enviarDocumentoZapiParaLead } from '../zapi'

// Envio de DOCUMENTO (PDF) pela Z-API. Nenhum teste toca a rede: `fetch` é
// sempre injetado via deps.

const ENV_OK = { ZAPI_INSTANCE_ID: 'inst-1', ZAPI_TOKEN: 'tok-SECRETO', ZAPI_CLIENT_TOKEN: 'ct-SECRETO' }
const PDF = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]) // "%PDF-1.7"

type RespostaFake = { status: number; corpo: unknown } | { lanca: string }
const CONECTADA: RespostaFake = { status: 200, corpo: { connected: true, smartphoneConnected: true } }
const ENVIO_OK: RespostaFake = { status: 200, corpo: { messageId: 'M1', zaapId: 'Z1' } }
type Caminho = 'status' | 'send-document/pdf'

function fetchRoteado(rotas: { status?: RespostaFake; documento?: RespostaFake } = {}) {
  const chamadas: Array<{ caminho: Caminho; url: string; init: RequestInit }> = []
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url)
    const caminho: Caminho | null = u.endsWith('/status') ? 'status' : u.endsWith('/send-document/pdf') ? 'send-document/pdf' : null
    if (!caminho) throw new Error('rota inesperada: ' + u)
    chamadas.push({ caminho, url: u, init: init ?? {} })
    const r = caminho === 'status' ? (rotas.status ?? CONECTADA) : (rotas.documento ?? ENVIO_OK)
    if ('lanca' in r) throw new Error(r.lanca)
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.corpo } as unknown as Response
  })
  const so = (c: Caminho) => chamadas.filter((x) => x.caminho === c)
  return { fn: fn as unknown as typeof fetch, chamadas, so }
}

const corpoEnviado = (init: RequestInit) => JSON.parse(String(init.body)) as Record<string, string>

describe('sendDocumentPdf', () => {
  it('env ausente → config_ausente, sem rede', async () => {
    const f = fetchRoteado()
    const r = await sendDocumentPdf({ phone: '5511999998888', pdf: PDF, fileName: 'a.pdf' }, { fetch: f.fn, env: {} })
    expect(r).toMatchObject({ ok: false, codigo: 'config_ausente' })
    expect(f.chamadas).toHaveLength(0)
  })

  it('POST /send-document/pdf com Client-Token, PDF em data URI, nome sem extensão e legenda', async () => {
    const f = fetchRoteado()
    const r = await sendDocumentPdf(
      { phone: '5511999998888', pdf: PDF, fileName: 'proposta-acme-2026-09-14.pdf', caption: '  Segue a proposta.  ' },
      { fetch: f.fn, env: ENV_OK },
    )
    expect(r).toEqual({ ok: true, messageId: 'M1', zaapId: 'Z1' })
    const { url, init } = f.chamadas[0]
    expect(url).toBe('https://api.z-api.io/instances/inst-1/token/tok-SECRETO/send-document/pdf')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Client-Token']).toBe('ct-SECRETO')
    const body = corpoEnviado(init)
    expect(body.phone).toBe('5511999998888')
    expect(body.fileName).toBe('proposta-acme-2026-09-14')
    expect(body.caption).toBe('Segue a proposta.')
    expect(body.document.startsWith('data:application/pdf;base64,')).toBe(true)
    expect(new Uint8Array(Buffer.from(body.document.split(',')[1], 'base64'))).toEqual(PDF)
  })

  it('sem legenda → corpo sem caption', async () => {
    const f = fetchRoteado()
    await sendDocumentPdf({ phone: '5511999998888', pdf: PDF, fileName: 'a.pdf' }, { fetch: f.fn, env: ENV_OK })
    expect(corpoEnviado(f.chamadas[0].init)).not.toHaveProperty('caption')
  })

  it('não-2xx → erro_provider sem vazar credenciais', async () => {
    const f = fetchRoteado({ documento: { status: 400, corpo: { message: 'invalid document' } } })
    const r = await sendDocumentPdf({ phone: '5511999998888', pdf: PDF, fileName: 'a.pdf' }, { fetch: f.fn, env: ENV_OK })
    expect(r).toMatchObject({ ok: false, codigo: 'erro_provider', status: 400 })
    expect(JSON.stringify(r)).not.toContain('SECRETO')
  })
})

type LeadFake = { id: string; contato_telefone: string | null; contato_nome?: string | null } | null
function adminFake(lead: LeadFake, opts: { upsertErro?: string } = {}) {
  const filtros: Array<[string, unknown]> = []
  const upserts: Array<{ row: Record<string, unknown>; opts: Record<string, unknown> }> = []
  const leads = {
    select: () => leads,
    eq: (col: string, val: unknown) => { filtros.push([col, val]); return leads },
    maybeSingle: async () => ({ data: lead, error: null }),
  }
  const mensagens = {
    upsert(row: Record<string, unknown>, o: Record<string, unknown>) {
      upserts.push({ row, opts: o })
      return {
        select: () => ({
          maybeSingle: async () => opts.upsertErro
            ? { data: null, error: { message: opts.upsertErro } }
            : { data: { id: 'ROW-1' }, error: null },
        }),
      }
    },
  }
  const client = {
    from: (t: string) => {
      if (t === 'leads') return leads
      if (t === 'whatsapp_mensagens') return mensagens
      throw new Error('tabela inesperada: ' + t)
    },
  } as unknown as SupabaseClient
  return { client, filtros, upserts }
}

describe('enviarDocumentoZapiParaLead', () => {
  const ORG = 'org-A'
  const LEAD: LeadFake = { id: 'L1', contato_telefone: '(11) 99999-8888', contato_nome: 'Fulano' }
  const entrada = { leadId: 'L1', organizacaoId: ORG, pdf: PDF, fileName: 'proposta-acme-2026-09-14.pdf', caption: 'Segue a proposta.' }
  const deps = (f: ReturnType<typeof fetchRoteado>) => ({ fetch: f.fn, env: ENV_OK })

  it('documento vazio → documento_vazio, sem banco nem rede', async () => {
    const { client, filtros } = adminFake(LEAD)
    const f = fetchRoteado()
    const r = await enviarDocumentoZapiParaLead(client, { ...entrada, pdf: new Uint8Array() }, deps(f))
    expect(r).toMatchObject({ ok: false, codigo: 'documento_vazio' })
    expect(filtros).toHaveLength(0)
    expect(f.chamadas).toHaveLength(0)
  })

  it('lead de outra organização → lead_nao_encontrado; filtro pela org da sessão; sem rede', async () => {
    const { client, filtros } = adminFake(null)
    const f = fetchRoteado()
    const r = await enviarDocumentoZapiParaLead(client, entrada, deps(f))
    expect(r).toMatchObject({ ok: false, codigo: 'lead_nao_encontrado' })
    expect(filtros).toEqual(expect.arrayContaining([['id', 'L1'], ['organizacao_id', ORG]]))
    expect(f.chamadas).toHaveLength(0)
  })

  it('instância desconectada → zapi_desconectada; send-document NÃO é chamado; nada gravado', async () => {
    const { client, upserts } = adminFake(LEAD)
    const f = fetchRoteado({ status: { status: 200, corpo: { connected: false, smartphoneConnected: false } } })
    const r = await enviarDocumentoZapiParaLead(client, entrada, deps(f))
    expect(r).toMatchObject({ ok: false, codigo: 'zapi_desconectada' })
    expect(f.so('send-document/pdf')).toHaveLength(0)
    expect(upserts).toHaveLength(0)
  })

  it('sucesso: status → send-document (1x) → grava UM outbound tipo document da org', async () => {
    const { client, upserts } = adminFake(LEAD)
    const f = fetchRoteado()
    const r = await enviarDocumentoZapiParaLead(client, entrada, deps(f))
    expect(r).toEqual({ ok: true, provider: 'zapi', telefone: '5511999998888', registrada: true, mensagemId: 'ROW-1', messageId: 'M1', zaapId: 'Z1' })
    expect(f.chamadas.map((c) => c.caminho)).toEqual(['status', 'send-document/pdf'])
    expect(corpoEnviado(f.so('send-document/pdf')[0].init).phone).toBe('5511999998888')
    expect(upserts).toHaveLength(1)
    expect(upserts[0].row).toMatchObject({
      whatsapp_message_id: 'M1', direcao: 'outbound', lead_id: 'L1', organizacao_id: ORG,
      remetente: '5511999998888', remetente_nome: 'Fulano', tipo: 'document',
      payload: { origem: 'prospectos.outbound', provider: 'zapi', fileName: 'proposta-acme-2026-09-14.pdf', messageId: 'M1', zaapId: 'Z1' },
    })
    expect(String(upserts[0].row.conteudo)).toContain('proposta-acme-2026-09-14.pdf')
    expect(String(upserts[0].row.conteudo)).toContain('Segue a proposta.')
  })

  it('erro do BANCO após a Z-API aceitar → ok, registrada=false, send-document chamado UMA vez', async () => {
    const { client } = adminFake(LEAD, { upsertErro: 'violação' })
    const f = fetchRoteado()
    const r = await enviarDocumentoZapiParaLead(client, entrada, deps(f))
    expect(r).toMatchObject({ ok: true, registrada: false, mensagemId: null })
    expect(f.so('send-document/pdf')).toHaveLength(1)
  })
})
