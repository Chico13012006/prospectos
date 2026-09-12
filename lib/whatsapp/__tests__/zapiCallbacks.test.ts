import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  lerConfigWebhookZapi,
  validarSegredoWebhook,
  interpretarDeliveryCallback,
  interpretarMessageStatusCallback,
  aplicarDelivery,
  aplicarStatus,
  registrarDelivery,
  registrarStatus,
} from '../zapiCallbacks'

// Tudo puro ou com Supabase falso. Nenhuma chamada externa; nenhum fetch no módulo.

const INSTANCIA = 'inst-1'

// Formatos REAIS da documentação da Z-API.
function delivery(over: Record<string, unknown> = {}) {
  return {
    phone: '554499999999',
    zaapId: 'ZAAP-1',
    messageId: 'MSG-1',
    instanceId: INSTANCIA,
    momment: 1777494009341,
    type: 'DeliveryCallback',
    ...over,
  }
}
function statusCb(over: Record<string, unknown> = {}) {
  return {
    instanceId: INSTANCIA,
    status: 'READ',
    ids: ['MSG-1'],
    momment: 1632234645000,
    phoneDevice: 0,
    phone: '5544999999999',
    type: 'MessageStatusCallback',
    isGroup: false,
    ...over,
  }
}

// Payload como o outbound Z-API grava — tem de sobreviver intacto.
const PAYLOAD_OUTBOUND = { origem: 'prospectos.outbound', provider: 'zapi', messageId: 'MSG-1', zaapId: 'ZAAP-1' }

describe('guarda das rotas', () => {
  it('lerConfigWebhookZapi exige segredo e instância', () => {
    expect(lerConfigWebhookZapi({})).toEqual({ ok: false, faltando: 'ZAPI_WEBHOOK_SECRET' })
    expect(lerConfigWebhookZapi({ ZAPI_WEBHOOK_SECRET: 's' })).toEqual({ ok: false, faltando: 'ZAPI_INSTANCE_ID' })
    expect(lerConfigWebhookZapi({ ZAPI_WEBHOOK_SECRET: 's', ZAPI_INSTANCE_ID: 'i' })).toEqual({ ok: true, secret: 's', instanceId: 'i' })
  })
  it('segredo: só o exato passa; ausente/errado falha', () => {
    expect(validarSegredoWebhook('s3cr3t', 's3cr3t')).toBe(true)
    expect(validarSegredoWebhook('s3cr3x', 's3cr3t')).toBe(false)
    expect(validarSegredoWebhook(null, 's3cr3t')).toBe(false)
    expect(validarSegredoWebhook('s3cr3t', undefined)).toBe(false)
  })
})

describe('interpretarDeliveryCallback', () => {
  it('callback válido → evento com messageId, zaapId, instante e sem erro', () => {
    const r = interpretarDeliveryCallback(delivery(), INSTANCIA)
    expect(r).toEqual({
      tipo: 'evento',
      evento: { instanceId: INSTANCIA, messageId: 'MSG-1', zaapId: 'ZAAP-1', em: '2026-04-29T20:20:09.341Z', momment: 1777494009341, erro: null },
    })
  })
  it('com `error` → erro preenchido', () => {
    const r = interpretarDeliveryCallback(delivery({ error: 'Invalid phone number' }), INSTANCIA)
    expect(r.tipo === 'evento' && r.evento.erro).toBe('Invalid phone number')
  })
  it('instanceId diferente → ignorar', () => {
    expect(interpretarDeliveryCallback(delivery({ instanceId: 'outra' }), INSTANCIA)).toEqual({ tipo: 'ignorar', motivo: 'instancia_desconhecida' })
  })
  it('type diferente → ignorar', () => {
    expect(interpretarDeliveryCallback(delivery({ type: 'ReceivedCallback' }), INSTANCIA)).toEqual({ tipo: 'ignorar', motivo: 'tipo_nao_suportado' })
  })
  it('sem messageId → inválido', () => {
    expect(interpretarDeliveryCallback(delivery({ messageId: '' }), INSTANCIA)).toEqual({ tipo: 'invalido', motivo: 'messageId ausente' })
  })
  it('momment ausente cai para agora', () => {
    const r = interpretarDeliveryCallback(delivery({ momment: undefined }), INSTANCIA)
    expect(r.tipo === 'evento' && r.evento.momment).toBeNull()
  })
})

describe('aplicarDelivery', () => {
  const ev = { instanceId: INSTANCIA, messageId: 'MSG-1', zaapId: 'ZAAP-1', em: '2026-04-29T20:20:09.341Z', momment: 1777494009341, erro: null }

  it('adiciona `delivery` preservando TODO o payload anterior', () => {
    const { payload, alterado } = aplicarDelivery(PAYLOAD_OUTBOUND, ev)
    expect(alterado).toBe(true)
    expect(payload).toEqual({
      ...PAYLOAD_OUTBOUND,
      delivery: { status: 'entregue', recebidoEm: ev.em, momment: ev.momment, zaapId: 'ZAAP-1' },
    })
  })
  it('erro de entrega é registrado', () => {
    const { payload } = aplicarDelivery(PAYLOAD_OUTBOUND, { ...ev, erro: 'Invalid phone number' })
    expect(payload.delivery).toMatchObject({ status: 'erro', erro: 'Invalid phone number' })
    expect(payload.provider).toBe('zapi') // nada perdido
  })
  it('duplicado (mesmo instante e resultado) → sem alteração', () => {
    const primeira = aplicarDelivery(PAYLOAD_OUTBOUND, ev).payload
    const segunda = aplicarDelivery(primeira, ev)
    expect(segunda.alterado).toBe(false)
    expect(segunda.payload).toBe(primeira)
  })
  it('evento MAIS ANTIGO não sobrescreve o mais novo', () => {
    const novo = aplicarDelivery(PAYLOAD_OUTBOUND, ev).payload
    const antigo = aplicarDelivery(novo, { ...ev, em: '2026-04-29T20:00:00.000Z', momment: 1777492800000, erro: 'x' })
    expect(antigo.alterado).toBe(false)
  })
  it('evento MAIS NOVO substitui (ex.: erro depois de entregue)', () => {
    const antes = aplicarDelivery(PAYLOAD_OUTBOUND, ev).payload
    const depois = aplicarDelivery(antes, { ...ev, em: '2026-04-29T20:30:00.000Z', erro: 'timeout' })
    expect(depois.alterado).toBe(true)
    expect(depois.payload.delivery).toMatchObject({ status: 'erro', erro: 'timeout' })
  })
  it('payload nulo/estranho vira objeto sem quebrar', () => {
    expect(aplicarDelivery(null, ev).payload.delivery).toBeDefined()
    expect(aplicarDelivery('lixo', ev).payload.delivery).toBeDefined()
  })
})

describe('interpretarMessageStatusCallback', () => {
  it('status válido com `ids` (array) → evento', () => {
    const r = interpretarMessageStatusCallback(statusCb({ ids: ['A', 'B'] }), INSTANCIA)
    expect(r).toEqual({
      tipo: 'evento',
      evento: { instanceId: INSTANCIA, ids: ['A', 'B'], status: 'READ', em: '2021-09-21T14:30:45.000Z', momment: 1632234645000 },
    })
  })
  it('aceita exatamente os 5 status documentados', () => {
    for (const s of ['SENT', 'RECEIVED', 'READ', 'READ_BY_ME', 'PLAYED']) {
      expect(interpretarMessageStatusCallback(statusCb({ status: s }), INSTANCIA).tipo).toBe('evento')
    }
  })
  it('status fora da lista → ignorar (não inventa enum)', () => {
    expect(interpretarMessageStatusCallback(statusCb({ status: 'DELIVERED' }), INSTANCIA)).toEqual({ tipo: 'ignorar', motivo: 'status_desconhecido' })
  })
  it('isGroup → ignorar', () => {
    expect(interpretarMessageStatusCallback(statusCb({ isGroup: true }), INSTANCIA)).toEqual({ tipo: 'ignorar', motivo: 'grupo' })
  })
  it('instanceId diferente → ignorar', () => {
    expect(interpretarMessageStatusCallback(statusCb({ instanceId: 'outra' }), INSTANCIA)).toEqual({ tipo: 'ignorar', motivo: 'instancia_desconhecida' })
  })
  it('ids ausente/vazio/inválido → inválido', () => {
    expect(interpretarMessageStatusCallback(statusCb({ ids: [] }), INSTANCIA).tipo).toBe('invalido')
    expect(interpretarMessageStatusCallback(statusCb({ ids: 'MSG-1' }), INSTANCIA).tipo).toBe('invalido')
    expect(interpretarMessageStatusCallback(statusCb({ ids: [''] }), INSTANCIA).tipo).toBe('invalido')
  })
  it('momment (ms) vira ISO', () => {
    const r = interpretarMessageStatusCallback(statusCb({ momment: 1700000000000 }), INSTANCIA)
    expect(r.tipo === 'evento' && r.evento.em).toBe('2023-11-14T22:13:20.000Z')
  })
})

describe('aplicarStatus (ordem por tempo, histórico)', () => {
  const ev = (status: 'SENT' | 'RECEIVED' | 'READ' | 'READ_BY_ME' | 'PLAYED', em: string) =>
    ({ instanceId: INSTANCIA, ids: ['MSG-1'], status, em, momment: new Date(em).getTime() })

  it('primeiro status: define messageStatus e abre histórico, preservando o payload', () => {
    const { payload, alterado } = aplicarStatus(PAYLOAD_OUTBOUND, ev('SENT', '2026-01-01T10:00:00.000Z'))
    expect(alterado).toBe(true)
    expect(payload).toMatchObject({
      ...PAYLOAD_OUTBOUND,
      messageStatus: { status: 'SENT', atualizadoEm: '2026-01-01T10:00:00.000Z' },
    })
    expect(payload.statusHistorico).toHaveLength(1)
  })

  it('sequência SENT → RECEIVED → READ atualiza e acumula histórico', () => {
    let p: unknown = PAYLOAD_OUTBOUND
    p = aplicarStatus(p, ev('SENT', '2026-01-01T10:00:00.000Z')).payload
    p = aplicarStatus(p, ev('RECEIVED', '2026-01-01T10:00:05.000Z')).payload
    const r = aplicarStatus(p, ev('READ', '2026-01-01T10:01:00.000Z'))
    expect(r.payload.messageStatus).toMatchObject({ status: 'READ', atualizadoEm: '2026-01-01T10:01:00.000Z' })
    expect((r.payload.statusHistorico as unknown[]).map((h) => (h as { status: string }).status)).toEqual(['SENT', 'RECEIVED', 'READ'])
  })

  it('status ATRASADO (mais antigo) não rebaixa o atual, mas entra no histórico', () => {
    let p: unknown = aplicarStatus(PAYLOAD_OUTBOUND, ev('READ', '2026-01-01T10:01:00.000Z')).payload
    const r = aplicarStatus(p, ev('SENT', '2026-01-01T10:00:00.000Z'))
    expect(r.alterado).toBe(true) // histórico ganhou o evento
    expect(r.payload.messageStatus).toMatchObject({ status: 'READ' }) // não rebaixou
    expect((r.payload.statusHistorico as unknown[]).length).toBe(2)
    p = r.payload
  })

  it('callback DUPLICADO (mesmo status + instante) → sem alteração', () => {
    const primeiro = aplicarStatus(PAYLOAD_OUTBOUND, ev('READ', '2026-01-01T10:01:00.000Z')).payload
    const dup = aplicarStatus(primeiro, ev('READ', '2026-01-01T10:01:00.000Z'))
    expect(dup.alterado).toBe(false)
    expect(dup.payload).toBe(primeiro)
  })

  it('histórico é capado', () => {
    let p: unknown = PAYLOAD_OUTBOUND
    for (let i = 0; i < 30; i++) {
      p = aplicarStatus(p, ev('READ', new Date(1700000000000 + i * 1000).toISOString())).payload
    }
    expect(((p as { statusHistorico: unknown[] }).statusHistorico).length).toBe(20)
  })
})

// Supabase fake para whatsapp_mensagens: `linhas` indexadas por
// whatsapp_message_id; registra selects e updates. NUNCA expõe insert/upsert —
// se o código tentasse criar mensagem, o fake lançaria.
function adminFake(linhas: Record<string, { id: string; payload: unknown }>, opts: { updateErro?: string } = {}) {
  const updates: Array<{ rowId: string; messageId: string; payload: unknown }> = []
  const selects: string[] = []
  const client = {
    from(t: string) {
      if (t !== 'whatsapp_mensagens') throw new Error('tabela inesperada: ' + t)
      return {
        select: () => ({
          eq: (_col: string, messageId: string) => ({
            maybeSingle: async () => { selects.push(messageId); return { data: linhas[messageId] ?? null, error: null } },
          }),
        }),
        update: (patch: { payload: unknown }) => ({
          eq: (_c1: string, rowId: string) => ({
            eq: async (_c2: string, messageId: string) => {
              if (opts.updateErro) return { error: { message: opts.updateErro } }
              updates.push({ rowId, messageId, payload: patch.payload })
              if (linhas[messageId]) linhas[messageId].payload = patch.payload
              return { error: null }
            },
          }),
        }),
        insert: () => { throw new Error('INSERT proibido neste fluxo') },
        upsert: () => { throw new Error('UPSERT proibido neste fluxo') },
      }
    },
  } as unknown as SupabaseClient
  return { client, updates, selects }
}

describe('registrarDelivery', () => {
  const ev = { instanceId: INSTANCIA, messageId: 'MSG-1', zaapId: 'ZAAP-1', em: '2026-04-29T20:20:09.341Z', momment: 1777494009341, erro: null }

  it('mensagem existente → atualiza SÓ o payload, preservando o anterior', async () => {
    const { client, updates } = adminFake({ 'MSG-1': { id: 'ROW-1', payload: { ...PAYLOAD_OUTBOUND } } })
    expect(await registrarDelivery(client, ev)).toBe('atualizada')
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({ rowId: 'ROW-1', messageId: 'MSG-1' })
    expect(updates[0].payload).toMatchObject({ ...PAYLOAD_OUTBOUND, delivery: { status: 'entregue' } })
  })
  it('mensagem INEXISTENTE → orfa, nada gravado, nenhum insert', async () => {
    const { client, updates } = adminFake({})
    expect(await registrarDelivery(client, ev)).toBe('orfa')
    expect(updates).toHaveLength(0)
  })
  it('callback duplicado → sem_alteracao, sem segundo update', async () => {
    const { client, updates } = adminFake({ 'MSG-1': { id: 'ROW-1', payload: { ...PAYLOAD_OUTBOUND } } })
    await registrarDelivery(client, ev)
    expect(await registrarDelivery(client, ev)).toBe('sem_alteracao')
    expect(updates).toHaveLength(1)
  })
  it('erro do banco → erro (sem lançar)', async () => {
    const { client } = adminFake({ 'MSG-1': { id: 'ROW-1', payload: {} } }, { updateErro: 'boom' })
    expect(await registrarDelivery(client, ev)).toBe('erro')
  })
  it('localiza SÓ por whatsapp_message_id — nunca toca lead_id/organizacao_id', async () => {
    const { client, updates, selects } = adminFake({ 'MSG-1': { id: 'ROW-1', payload: {} } })
    await registrarDelivery(client, ev)
    expect(selects).toEqual(['MSG-1'])
    const patch = updates[0].payload as Record<string, unknown>
    expect(Object.keys(patch)).toEqual(['delivery'])
  })
})

describe('registrarStatus', () => {
  const ev = { instanceId: INSTANCIA, ids: ['MSG-1', 'MSG-2', 'MSG-X'], status: 'READ' as const, em: '2026-01-01T10:01:00.000Z', momment: 1767261660000 }

  it('vários ids: cada um tratado à parte; desconhecido é orfa sem insert', async () => {
    const { client, updates } = adminFake({
      'MSG-1': { id: 'ROW-1', payload: { ...PAYLOAD_OUTBOUND } },
      'MSG-2': { id: 'ROW-2', payload: { origem: 'zapi.received', provider: 'zapi' } },
    })
    const r = await registrarStatus(client, ev)
    expect(r).toEqual({ 'MSG-1': 'atualizada', 'MSG-2': 'atualizada', 'MSG-X': 'orfa' })
    expect(updates).toHaveLength(2)
    expect(updates.find((u) => u.messageId === 'MSG-2')?.payload).toMatchObject({ origem: 'zapi.received', provider: 'zapi', messageStatus: { status: 'READ' } })
  })
  it('duplicado → sem_alteracao; atrasado não rebaixa', async () => {
    const { client, updates } = adminFake({ 'MSG-1': { id: 'ROW-1', payload: { ...PAYLOAD_OUTBOUND } } })
    const so = { ...ev, ids: ['MSG-1'] }
    expect((await registrarStatus(client, so))['MSG-1']).toBe('atualizada')
    expect((await registrarStatus(client, so))['MSG-1']).toBe('sem_alteracao')
    const atrasado = await registrarStatus(client, { ...so, status: 'SENT', em: '2026-01-01T10:00:00.000Z', momment: 1767261600000 })
    expect(atrasado['MSG-1']).toBe('atualizada') // entrou no histórico
    const final = updates[updates.length - 1].payload as { messageStatus: { status: string } }
    expect(final.messageStatus.status).toBe('READ') // mas o atual não rebaixou
  })
})
