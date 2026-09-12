import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendText, lerConfigZapi, enviarTextoZapiParaLead } from '../zapi'

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

// Supabase fake: registra os filtros aplicados na leitura do lead e devolve o
// que o teste mandar. Só o caminho leads.select().eq().eq().maybeSingle().
function adminFake(lead: { id: string; contato_telefone: string | null } | null) {
  const filtros: Array<[string, unknown]> = []
  const builder = {
    select: () => builder,
    eq: (col: string, val: unknown) => { filtros.push([col, val]); return builder },
    maybeSingle: async () => ({ data: lead, error: null }),
  }
  const client = { from: (t: string) => { expect(t).toBe('leads'); return builder } } as unknown as SupabaseClient
  return { client, filtros }
}

describe('enviarTextoZapiParaLead', () => {
  const ORG = 'org-A'

  it('mensagem vazia → texto_vazio, sem ler o banco nem a rede', async () => {
    const f = fetchFake(200, { messageId: 'M' })
    const { client, filtros } = adminFake({ id: 'L1', contato_telefone: '11999998888' })
    const r = await enviarTextoZapiParaLead(client, { leadId: 'L1', message: '   ', organizacaoId: ORG }, { fetch: f.fn, env: ENV_OK })
    expect(r).toMatchObject({ ok: false, codigo: 'texto_vazio' })
    expect(filtros).toHaveLength(0)
    expect(f.chamadas).toHaveLength(0)
  })

  it('lead inexistente → lead_nao_encontrado', async () => {
    const f = fetchFake(200, { messageId: 'M' })
    const { client } = adminFake(null)
    const r = await enviarTextoZapiParaLead(client, { leadId: 'nao-existe', message: 'oi', organizacaoId: ORG }, { fetch: f.fn, env: ENV_OK })
    expect(r).toMatchObject({ ok: false, codigo: 'lead_nao_encontrado' })
    expect(f.chamadas).toHaveLength(0)
  })

  it('SEMPRE filtra por organizacao_id da sessão (isolamento)', async () => {
    const f = fetchFake(200, { messageId: 'M' })
    // O fake devolve null simulando o que o banco faz quando o lead é de outra org.
    const { client, filtros } = adminFake(null)
    const r = await enviarTextoZapiParaLead(client, { leadId: 'L-de-outra-org', message: 'oi', organizacaoId: ORG }, { fetch: f.fn, env: ENV_OK })
    expect(filtros).toContainEqual(['id', 'L-de-outra-org'])
    expect(filtros).toContainEqual(['organizacao_id', ORG])
    expect(r).toMatchObject({ ok: false, codigo: 'lead_nao_encontrado' })
  })

  it('lead sem telefone → sem_telefone', async () => {
    const f = fetchFake(200, { messageId: 'M' })
    const { client } = adminFake({ id: 'L1', contato_telefone: null })
    const r = await enviarTextoZapiParaLead(client, { leadId: 'L1', message: 'oi', organizacaoId: ORG }, { fetch: f.fn, env: ENV_OK })
    expect(r).toMatchObject({ ok: false, codigo: 'sem_telefone' })
    expect(f.chamadas).toHaveLength(0)
  })

  it('telefone com máscara e sem DDI é normalizado para 55 + dígitos', async () => {
    const f = fetchFake(200, { messageId: 'M1', zaapId: 'Z1' })
    const { client } = adminFake({ id: 'L1', contato_telefone: '(11) 99999-8888' })
    const r = await enviarTextoZapiParaLead(client, { leadId: 'L1', message: 'Teste', organizacaoId: ORG }, { fetch: f.fn, env: ENV_OK })
    expect(r).toEqual({ ok: true, provider: 'zapi', telefone: '5511999998888', messageId: 'M1', zaapId: 'Z1' })
    expect(JSON.parse(String(f.chamadas[0].init.body)).phone).toBe('5511999998888')
  })

  it('telefone irreconhecível → sem_telefone (não tenta enviar)', async () => {
    const f = fetchFake(200, { messageId: 'M' })
    const { client } = adminFake({ id: 'L1', contato_telefone: '2196902361521979393105' })
    const r = await enviarTextoZapiParaLead(client, { leadId: 'L1', message: 'oi', organizacaoId: ORG }, { fetch: f.fn, env: ENV_OK })
    expect(r).toMatchObject({ ok: false, codigo: 'sem_telefone' })
    expect(f.chamadas).toHaveLength(0)
  })

  it('erro da Z-API é repassado com o código do adapter', async () => {
    const f = fetchFake(500, { error: 'instance disconnected' })
    const { client } = adminFake({ id: 'L1', contato_telefone: '11999998888' })
    const r = await enviarTextoZapiParaLead(client, { leadId: 'L1', message: 'oi', organizacaoId: ORG }, { fetch: f.fn, env: ENV_OK })
    expect(r).toMatchObject({ ok: false, codigo: 'erro_provider', status: 500 })
  })
})
