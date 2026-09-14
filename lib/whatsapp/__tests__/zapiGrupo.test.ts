import { describe, it, expect, vi } from 'vitest'
import { grupoIdValido, sendGroupText } from '../zapi'

// Envio a GRUPO pela Z-API: mesmo send-text com o id do grupo em `phone`, com
// consulta de /status antes. Nenhum teste toca a rede: `fetch` é injetado.

const ENV_OK = { ZAPI_INSTANCE_ID: 'inst-1', ZAPI_TOKEN: 'tok', ZAPI_CLIENT_TOKEN: 'ct' }
const GRUPO = '120363019502650977-group'

// fetch falso roteado por caminho: /status e /send-text respondem diferente.
function fetchRoteado(status: { connected: boolean; smartphoneConnected?: boolean } | null, envio: unknown = { messageId: 'M1' }) {
  const chamadas: Array<{ url: string; body?: unknown }> = []
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url)
    chamadas.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (u.endsWith('/status')) {
      if (!status) throw new Error('rede caiu')
      return { ok: true, status: 200, json: async () => status } as unknown as Response
    }
    return { ok: true, status: 200, json: async () => envio } as unknown as Response
  })
  return { fn: fn as unknown as typeof fetch, chamadas }
}

describe('grupoIdValido', () => {
  it('aceita "<id>-group" e "<id>@g.us"; rejeita telefone puro e lixo', () => {
    expect(grupoIdValido(GRUPO)).toBe(true)
    expect(grupoIdValido('120363019502650977@g.us')).toBe(true)
    expect(grupoIdValido('5511999998888')).toBe(false)
    expect(grupoIdValido('')).toBe(false)
    expect(grupoIdValido('abc-group')).toBe(false)
  })
})

describe('sendGroupText', () => {
  it('id inválido ou texto vazio → erro controlado, sem rede', async () => {
    const f = fetchRoteado({ connected: true, smartphoneConnected: true })
    expect(await sendGroupText({ groupId: '5511999998888', message: 'oi' }, { fetch: f.fn, env: ENV_OK })).toMatchObject({ ok: false, codigo: 'grupo_invalido' })
    expect(await sendGroupText({ groupId: GRUPO, message: '  ' }, { fetch: f.fn, env: ENV_OK })).toMatchObject({ ok: false, codigo: 'texto_vazio' })
    expect(f.chamadas).toHaveLength(0)
  })

  it('env ausente → config_ausente', async () => {
    const f = fetchRoteado({ connected: true })
    expect(await sendGroupText({ groupId: GRUPO, message: 'oi' }, { fetch: f.fn, env: {} })).toMatchObject({ ok: false, codigo: 'config_ausente' })
    expect(f.chamadas).toHaveLength(0)
  })

  it('instância desconectada → zapi_desconectada e send-text NÃO é chamado', async () => {
    const f = fetchRoteado({ connected: false })
    const r = await sendGroupText({ groupId: GRUPO, message: 'oi' }, { fetch: f.fn, env: ENV_OK })
    expect(r).toMatchObject({ ok: false, codigo: 'zapi_desconectada' })
    expect(f.chamadas.map((c) => c.url.split('/').pop())).toEqual(['status'])
  })

  it('status inacessível → zapi_status_falhou, sem enviar', async () => {
    const f = fetchRoteado(null)
    const r = await sendGroupText({ groupId: GRUPO, message: 'oi' }, { fetch: f.fn, env: ENV_OK })
    expect(r).toMatchObject({ ok: false, codigo: 'zapi_status_falhou' })
    expect(f.chamadas).toHaveLength(1)
  })

  it('conectada → send-text com phone = id do grupo; devolve os ids', async () => {
    const f = fetchRoteado({ connected: true, smartphoneConnected: true }, { messageId: 'M1', zaapId: 'Z1' })
    const r = await sendGroupText({ groupId: GRUPO, message: 'NOVO LEAD' }, { fetch: f.fn, env: ENV_OK })
    expect(r).toEqual({ ok: true, messageId: 'M1', zaapId: 'Z1' })
    expect(f.chamadas.map((c) => c.url.split('/').pop())).toEqual(['status', 'send-text'])
    expect(f.chamadas[1].body).toEqual({ phone: GRUPO, message: 'NOVO LEAD' })
  })
})
