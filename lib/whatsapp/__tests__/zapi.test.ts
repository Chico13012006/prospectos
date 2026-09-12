import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendText, getStatus, lerConfigZapi, enviarTextoZapiParaLead } from '../zapi'

// Nenhum teste aqui toca a rede: `fetch` é sempre injetado via deps.

const ENV_OK = { ZAPI_INSTANCE_ID: 'inst-1', ZAPI_TOKEN: 'tok-SECRETO', ZAPI_CLIENT_TOKEN: 'ct-SECRETO' }

function fetchFake(status: number, corpo: unknown, opts: { jsonInvalido?: boolean } = {}) {
  const chamadas: Array<{ url: string; init: RequestInit }> = []
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    chamadas.push({ url: String(url), init: init ?? {} })
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => { if (opts.jsonInvalido) throw new Error('not json'); return corpo },
    } as unknown as Response
  })
  return { fn: fn as unknown as typeof fetch, chamadas }
}

describe('lerConfigZapi', () => {
  it('null quando falta qualquer uma das três variáveis', () => {
    expect(lerConfigZapi({})).toBeNull()
    expect(lerConfigZapi({ ...ENV_OK, ZAPI_TOKEN: '' })).toBeNull()
    expect(lerConfigZapi({ ...ENV_OK, ZAPI_CLIENT_TOKEN: undefined })).toBeNull()
  })
  it('lê as três quando presentes', () => {
    expect(lerConfigZapi(ENV_OK)).toEqual({ instanceId: 'inst-1', token: 'tok-SECRETO', clientToken: 'ct-SECRETO' })
  })
})

describe('sendText', () => {
  it('env ausente → config_ausente, sem chamar a rede', async () => {
    const f = fetchFake(200, {})
    const r = await sendText({ phone: '5511999998888', message: 'oi' }, { fetch: f.fn, env: {} })
    expect(r).toMatchObject({ ok: false, codigo: 'config_ausente' })
    expect(f.chamadas).toHaveLength(0)
  })

  it('monta URL, header Client-Token e body corretos; devolve os ids', async () => {
    const f = fetchFake(200, { zaapId: 'Z1', messageId: 'M1', id: 'I1' })
    const r = await sendText({ phone: '5511999998888', message: 'Teste' }, { fetch: f.fn, env: ENV_OK })
    expect(r).toEqual({ ok: true, zaapId: 'Z1', messageId: 'M1', id: 'I1' })

    expect(f.chamadas).toHaveLength(1)
    const { url, init } = f.chamadas[0]
    expect(url).toBe('https://api.z-api.io/instances/inst-1/token/tok-SECRETO/send-text')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Client-Token']).toBe('ct-SECRETO')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(JSON.parse(String(init.body))).toEqual({ phone: '5511999998888', message: 'Teste' })
  })

  it('só inclui os ids que vieram', async () => {
    const f = fetchFake(200, { messageId: 'M1', extra: 'interno' })
    const r = await sendText({ phone: '5511999998888', message: 'x' }, { fetch: f.fn, env: ENV_OK })
    expect(r).toEqual({ ok: true, messageId: 'M1' })
    expect(r).not.toHaveProperty('extra')
  })

  it('não-2xx → erro_provider com status e mensagem SEM credenciais', async () => {
    const f = fetchFake(400, { message: 'invalid phone' })
    const r = await sendText({ phone: '55', message: 'x' }, { fetch: f.fn, env: ENV_OK })
    expect(r).toMatchObject({ ok: false, codigo: 'erro_provider', status: 400 })
    const texto = JSON.stringify(r)
    expect(texto).toContain('invalid phone')
    expect(texto).not.toContain('SECRETO')
  })

  it('2xx sem JSON → resposta_invalida', async () => {
    const f = fetchFake(200, null, { jsonInvalido: true })
    const r = await sendText({ phone: '5511999998888', message: 'x' }, { fetch: f.fn, env: ENV_OK })
    expect(r).toMatchObject({ ok: false, codigo: 'resposta_invalida' })
  })

  it('2xx sem nenhum id → resposta_invalida', async () => {
    const f = fetchFake(200, { status: 'queued' })
    const r = await sendText({ phone: '5511999998888', message: 'x' }, { fetch: f.fn, env: ENV_OK })
    expect(r).toMatchObject({ ok: false, codigo: 'resposta_invalida' })
  })

  it('fetch lança → falha_rede', async () => {
    const fn = vi.fn(async () => { throw new Error('ECONNRESET') }) as unknown as typeof fetch
    const r = await sendText({ phone: '5511999998888', message: 'x' }, { fetch: fn, env: ENV_OK })
    expect(r).toMatchObject({ ok: false, codigo: 'falha_rede' })
    expect((r as { mensagem: string }).mensagem).toContain('ECONNRESET')
  })
})

// Fetch fake que ROTEIA por URL: /status e /send-text respondem separado.
// Registra cada chamada para os testes contarem o que foi (ou não) chamado.
type RespostaFake = { status: number; corpo: unknown; jsonInvalido?: boolean } | { lanca: string }
const CONECTADA: RespostaFake = { status: 200, corpo: { connected: true, smartphoneConnected: true } }
const ENVIO_OK: RespostaFake = { status: 200, corpo: { messageId: 'M1', zaapId: 'Z1' } }

function fetchRoteado(rotas: { status?: RespostaFake; send?: RespostaFake }) {
  const chamadas: Array<{ caminho: 'status' | 'send-text'; init: RequestInit }> = []
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url)
    const caminho = u.endsWith('/status') ? 'status' : u.endsWith('/send-text') ? 'send-text' : null
    if (!caminho) throw new Error('rota inesperada: ' + u)
    chamadas.push({ caminho, init: init ?? {} })
    const r = caminho === 'status' ? (rotas.status ?? CONECTADA) : (rotas.send ?? ENVIO_OK)
    if ('lanca' in r) throw new Error(r.lanca)
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => { if (r.jsonInvalido) throw new Error('not json'); return r.corpo },
    } as unknown as Response
  })
  const so = (c: 'status' | 'send-text') => chamadas.filter((x) => x.caminho === c)
  return { fn: fn as unknown as typeof fetch, chamadas, so }
}

describe('getStatus', () => {
  it('env ausente → config_ausente, sem rede', async () => {
    const f = fetchRoteado({})
    const r = await getStatus({ fetch: f.fn, env: {} })
    expect(r).toMatchObject({ ok: false, codigo: 'config_ausente' })
    expect(f.chamadas).toHaveLength(0)
  })

  it('GET /status com Client-Token; conectada', async () => {
    const f = fetchRoteado({ status: { status: 200, corpo: { connected: true, smartphoneConnected: true } } })
    const r = await getStatus({ fetch: f.fn, env: ENV_OK })
    expect(r).toEqual({ ok: true, connected: true, smartphoneConnected: true })
    const { init } = f.so('status')[0]
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>)['Client-Token']).toBe('ct-SECRETO')
    expect(init.body).toBeUndefined()
  })

  it('instância desconectada', async () => {
    const f = fetchRoteado({ status: { status: 200, corpo: { connected: false, smartphoneConnected: false, error: 'You need to restore the session' } } })
    const r = await getStatus({ fetch: f.fn, env: ENV_OK })
    expect(r).toEqual({ ok: true, connected: false, smartphoneConnected: false, erro: 'You need to restore the session' })
  })

  it('celular desconectado', async () => {
    const f = fetchRoteado({ status: { status: 200, corpo: { connected: true, smartphoneConnected: false } } })
    const r = await getStatus({ fetch: f.fn, env: ENV_OK })
    expect(r).toMatchObject({ ok: true, connected: true, smartphoneConnected: false })
  })

  it('smartphoneConnected ausente conta como false', async () => {
    const f = fetchRoteado({ status: { status: 200, corpo: { connected: true } } })
    const r = await getStatus({ fetch: f.fn, env: ENV_OK })
    expect(r).toMatchObject({ ok: true, connected: true, smartphoneConnected: false })
  })

  it('não-2xx → erro_provider sem vazar credenciais', async () => {
    const f = fetchRoteado({ status: { status: 401, corpo: { error: 'unauthorized' } } })
    const r = await getStatus({ fetch: f.fn, env: ENV_OK })
    expect(r).toMatchObject({ ok: false, codigo: 'erro_provider', status: 401 })
    expect(JSON.stringify(r)).not.toContain('SECRETO')
  })

  it('corpo sem "connected" → resposta_invalida', async () => {
    const f = fetchRoteado({ status: { status: 200, corpo: { foo: 1 } } })
    const r = await getStatus({ fetch: f.fn, env: ENV_OK })
    expect(r).toMatchObject({ ok: false, codigo: 'resposta_invalida' })
  })

  it('fetch lança → falha_rede', async () => {
    const f = fetchRoteado({ status: { lanca: 'ETIMEDOUT' } })
    const r = await getStatus({ fetch: f.fn, env: ENV_OK })
    expect(r).toMatchObject({ ok: false, codigo: 'falha_rede' })
  })
})

// Supabase fake: leads.select().eq().eq().maybeSingle() e
// whatsapp_mensagens.upsert().select().maybeSingle(). Registra filtros do lead
// e cada upsert, para os testes verificarem isolamento e persistência.
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

describe('enviarTextoZapiParaLead', () => {
  const ORG = 'org-A'
  const LEAD: LeadFake = { id: 'L1', contato_telefone: '(11) 99999-8888', contato_nome: 'Fulano' }
  const deps = (f: ReturnType<typeof fetchRoteado>) => ({ fetch: f.fn, env: ENV_OK })

  it('mensagem vazia → texto_vazio, sem banco nem rede', async () => {
    const f = fetchRoteado({})
    const { client, filtros, upserts } = adminFake(LEAD)
    const r = await enviarTextoZapiParaLead(client, { leadId: 'L1', message: '   ', organizacaoId: ORG }, deps(f))
    expect(r).toMatchObject({ ok: false, codigo: 'texto_vazio' })
    expect(filtros).toHaveLength(0)
    expect(f.chamadas).toHaveLength(0)
    expect(upserts).toHaveLength(0)
  })

  it('lead inexistente → lead_nao_encontrado, sem rede', async () => {
    const f = fetchRoteado({})
    const { client, upserts } = adminFake(null)
    const r = await enviarTextoZapiParaLead(client, { leadId: 'nao-existe', message: 'oi', organizacaoId: ORG }, deps(f))
    expect(r).toMatchObject({ ok: false, codigo: 'lead_nao_encontrado' })
    expect(f.chamadas).toHaveLength(0)
    expect(upserts).toHaveLength(0)
  })

  it('SEMPRE filtra por organizacao_id da sessão (isolamento)', async () => {
    const f = fetchRoteado({})
    const { client, filtros } = adminFake(null)
    await enviarTextoZapiParaLead(client, { leadId: 'L-outra-org', message: 'oi', organizacaoId: ORG }, deps(f))
    expect(filtros).toContainEqual(['id', 'L-outra-org'])
    expect(filtros).toContainEqual(['organizacao_id', ORG])
  })

  it('lead sem telefone → sem_telefone, sem rede', async () => {
    const f = fetchRoteado({})
    const { client } = adminFake({ id: 'L1', contato_telefone: null })
    const r = await enviarTextoZapiParaLead(client, { leadId: 'L1', message: 'oi', organizacaoId: ORG }, deps(f))
    expect(r).toMatchObject({ ok: false, codigo: 'sem_telefone' })
    expect(f.chamadas).toHaveLength(0)
  })

  it('telefone irreconhecível → sem_telefone', async () => {
    const f = fetchRoteado({})
    const { client } = adminFake({ id: 'L1', contato_telefone: '2196902361521979393105' })
    const r = await enviarTextoZapiParaLead(client, { leadId: 'L1', message: 'oi', organizacaoId: ORG }, deps(f))
    expect(r).toMatchObject({ ok: false, codigo: 'sem_telefone' })
    expect(f.chamadas).toHaveLength(0)
  })

  it('instância DESCONECTADA → zapi_desconectada; send-text NÃO é chamado; nada gravado', async () => {
    const f = fetchRoteado({ status: { status: 200, corpo: { connected: false, smartphoneConnected: false, error: 'restore session' } } })
    const { client, upserts } = adminFake(LEAD)
    const r = await enviarTextoZapiParaLead(client, { leadId: 'L1', message: 'oi', organizacaoId: ORG }, deps(f))
    expect(r).toMatchObject({ ok: false, codigo: 'zapi_desconectada' })
    expect((r as { mensagem: string }).mensagem).toContain('instância desconectada')
    expect(f.so('status')).toHaveLength(1)
    expect(f.so('send-text')).toHaveLength(0)
    expect(upserts).toHaveLength(0)
  })

  it('celular desconectado → zapi_desconectada; send-text NÃO é chamado', async () => {
    const f = fetchRoteado({ status: { status: 200, corpo: { connected: true, smartphoneConnected: false } } })
    const { client, upserts } = adminFake(LEAD)
    const r = await enviarTextoZapiParaLead(client, { leadId: 'L1', message: 'oi', organizacaoId: ORG }, deps(f))
    expect(r).toMatchObject({ ok: false, codigo: 'zapi_desconectada' })
    expect((r as { mensagem: string }).mensagem).toContain('celular desconectado')
    expect(f.so('send-text')).toHaveLength(0)
    expect(upserts).toHaveLength(0)
  })

  it('erro ao consultar status → zapi_status_falhou; send-text NÃO é chamado', async () => {
    const f = fetchRoteado({ status: { lanca: 'ECONNRESET' } })
    const { client, upserts } = adminFake(LEAD)
    const r = await enviarTextoZapiParaLead(client, { leadId: 'L1', message: 'oi', organizacaoId: ORG }, deps(f))
    expect(r).toMatchObject({ ok: false, codigo: 'zapi_status_falhou' })
    expect(f.so('send-text')).toHaveLength(0)
    expect(upserts).toHaveLength(0)
  })

  it('sucesso: status → send-text (1x) → grava EXATAMENTE um outbound com os campos certos', async () => {
    const f = fetchRoteado({ send: { status: 200, corpo: { messageId: 'M1', zaapId: 'Z1' } } })
    const { client, upserts } = adminFake(LEAD)
    const r = await enviarTextoZapiParaLead(client, { leadId: 'L1', message: 'Teste', organizacaoId: ORG }, deps(f))

    expect(r).toEqual({ ok: true, provider: 'zapi', telefone: '5511999998888', registrada: true, mensagemId: 'ROW-1', messageId: 'M1', zaapId: 'Z1' })
    expect(f.so('status')).toHaveLength(1)
    expect(f.so('send-text')).toHaveLength(1)
    expect(JSON.parse(String(f.so('send-text')[0].init.body)).phone).toBe('5511999998888')

    expect(upserts).toHaveLength(1)
    const { row, opts } = upserts[0]
    expect(row).toMatchObject({
      whatsapp_message_id: 'M1',
      direcao: 'outbound',
      tipo: 'text',
      conteudo: 'Teste',
      remetente: '5511999998888',
      remetente_nome: 'Fulano',
      lead_id: 'L1',
      organizacao_id: ORG,
      phone_number_id: null,
      display_phone_number: null,
      payload: { origem: 'prospectos.outbound', provider: 'zapi', messageId: 'M1', zaapId: 'Z1' },
    })
    expect(typeof row.mensagem_em).toBe('string')
    expect(opts).toEqual({ onConflict: 'whatsapp_message_id', ignoreDuplicates: true })
    expect(JSON.stringify(row)).not.toContain('SECRETO')
  })

  it('sem messageId, usa zaapId como whatsapp_message_id', async () => {
    const f = fetchRoteado({ send: { status: 200, corpo: { zaapId: 'Z-only' } } })
    const { client, upserts } = adminFake(LEAD)
    const r = await enviarTextoZapiParaLead(client, { leadId: 'L1', message: 'oi', organizacaoId: ORG }, deps(f))
    expect(r).toMatchObject({ ok: true, zaapId: 'Z-only' })
    expect(upserts[0].row.whatsapp_message_id).toBe('Z-only')
  })

  it('erro do provider no send-text → NÃO grava', async () => {
    const f = fetchRoteado({ send: { status: 500, corpo: { error: 'instance error' } } })
    const { client, upserts } = adminFake(LEAD)
    const r = await enviarTextoZapiParaLead(client, { leadId: 'L1', message: 'oi', organizacaoId: ORG }, deps(f))
    expect(r).toMatchObject({ ok: false, codigo: 'erro_provider', status: 500 })
    expect(upserts).toHaveLength(0)
  })

  it('erro do BANCO após a Z-API aceitar → ok:true, registrada:false, e send-text chamado UMA vez só', async () => {
    const f = fetchRoteado({ send: { status: 200, corpo: { messageId: 'M1' } } })
    const { client, upserts } = adminFake(LEAD, { upsertErro: 'connection lost' })
    const r = await enviarTextoZapiParaLead(client, { leadId: 'L1', message: 'oi', organizacaoId: ORG }, deps(f))
    expect(r).toEqual({ ok: true, provider: 'zapi', telefone: '5511999998888', registrada: false, mensagemId: null, messageId: 'M1' })
    expect(f.so('send-text')).toHaveLength(1)
    expect(upserts).toHaveLength(1)
  })
})
