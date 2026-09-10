import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { extrairMensagensInbound, persistirMensagensInbound } from '../inbound'

// Payload de mensagem de texto no formato real da Meta.
function payloadTexto(over: Record<string, unknown> = {}) {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'WABA_1',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '5511000000000', phone_number_id: 'PN_1' },
          contacts: [{ profile: { name: 'Fulano da Silva' }, wa_id: '5511999998888' }],
          messages: [{
            from: '5511999998888',
            id: 'wamid.AAAA1111',
            timestamp: '1757460000',
            type: 'text',
            text: { body: 'Olá, tenho interesse' },
            ...over,
          }],
        },
      }],
    }],
  }
}

// Evento de STATUS (entrega/leitura) — não é mensagem.
const payloadStatus = {
  object: 'whatsapp_business_account',
  entry: [{
    id: 'WABA_1',
    changes: [{
      field: 'messages',
      value: {
        messaging_product: 'whatsapp',
        metadata: { display_phone_number: '5511000000000', phone_number_id: 'PN_1' },
        statuses: [{ id: 'wamid.AAAA1111', status: 'delivered', timestamp: '1757460050' }],
      },
    }],
  }],
}

describe('extrairMensagensInbound', () => {
  it('extrai uma mensagem de texto com todos os campos', () => {
    const [m] = extrairMensagensInbound(payloadTexto())
    expect(m.whatsappMessageId).toBe('wamid.AAAA1111')
    expect(m.remetente).toBe('5511999998888')
    expect(m.remetenteNome).toBe('Fulano da Silva')
    expect(m.tipo).toBe('text')
    expect(m.conteudo).toBe('Olá, tenho interesse')
    expect(m.mensagemEm).toBe(new Date(1757460000 * 1000).toISOString())
    expect(m.phoneNumberId).toBe('PN_1')
    expect(m.displayPhoneNumber).toBe('5511000000000')
    expect(m.payloadBruto).toMatchObject({ messaging_product: 'whatsapp' })
  })

  it('IGNORA evento de status (entrega/leitura) — lista vazia', () => {
    expect(extrairMensagensInbound(payloadStatus)).toEqual([])
  })

  it('ignora payloads malformados sem lançar', () => {
    for (const p of [null, undefined, {}, { entry: null }, { entry: [{}] }, 'texto', 42]) {
      expect(extrairMensagensInbound(p)).toEqual([])
    }
  })

  it('nome do contato ausente vira null, resto continua', () => {
    const p = payloadTexto()
    p.entry[0].changes[0].value.contacts = []
    const [m] = extrairMensagensInbound(p)
    expect(m.remetenteNome).toBeNull()
    expect(m.conteudo).toBe('Olá, tenho interesse')
  })

  it('descarta mensagem sem id ou sem from — não dá para deduplicar/atribuir', () => {
    const semId = payloadTexto({ id: undefined })
    const semFrom = payloadTexto({ from: undefined })
    expect(extrairMensagensInbound(semId)).toEqual([])
    expect(extrairMensagensInbound(semFrom)).toEqual([])
  })

  it('extrai texto de tipos não-text (botão, resposta interativa, caption)', () => {
    expect(extrairMensagensInbound(payloadTexto({
      type: 'button', text: undefined, button: { text: 'Quero saber mais' },
    }))[0].conteudo).toBe('Quero saber mais')

    expect(extrairMensagensInbound(payloadTexto({
      type: 'interactive', text: undefined,
      interactive: { button_reply: { title: 'Opção A' } },
    }))[0].conteudo).toBe('Opção A')

    expect(extrairMensagensInbound(payloadTexto({
      type: 'image', text: undefined, image: { caption: 'foto do equipamento' },
    }))[0].conteudo).toBe('foto do equipamento')
  })

  it('tipo sem texto (sticker) → conteudo null, mensagem ainda persiste', () => {
    const [m] = extrairMensagensInbound(payloadTexto({ type: 'sticker', text: undefined }))
    expect(m.tipo).toBe('sticker')
    expect(m.conteudo).toBeNull()
  })

  it('timestamp ausente/inválido cai para agora, sem quebrar', () => {
    const antes = Date.now()
    const [m] = extrairMensagensInbound(payloadTexto({ timestamp: undefined }))
    expect(new Date(m.mensagemEm).getTime()).toBeGreaterThanOrEqual(antes - 1000)
  })

  it('múltiplas mensagens no mesmo evento — todas extraídas', () => {
    const p = payloadTexto()
    p.entry[0].changes[0].value.messages.push({
      from: '5511999998888', id: 'wamid.BBBB2222', timestamp: '1757460100',
      type: 'text', text: { body: 'segunda' },
    })
    const ms = extrairMensagensInbound(p)
    expect(ms.map((m) => m.whatsappMessageId)).toEqual(['wamid.AAAA1111', 'wamid.BBBB2222'])
  })
})

// Cliente Supabase falso que registra a chamada de upsert e devolve um resultado
// controlado (linha nova, duplicata ou erro).
function fakeAdmin(modo: 'nova' | 'duplicada' | 'erro') {
  const chamadas: { onConflict?: string; ignoreDuplicates?: boolean; row: Record<string, unknown> }[] = []
  const client = {
    from() {
      return {
        upsert(row: Record<string, unknown>, opts: { onConflict?: string; ignoreDuplicates?: boolean }) {
          chamadas.push({ ...opts, row })
          return {
            select() {
              if (modo === 'erro') return Promise.resolve({ data: null, error: { message: 'boom' } })
              return Promise.resolve({ data: modo === 'nova' ? [{ id: 'X1' }] : [], error: null })
            },
          }
        },
      }
    },
  } as unknown as SupabaseClient
  return { client, chamadas }
}

const msgExemplo = {
  whatsappMessageId: 'wamid.AAAA1111',
  remetente: '5511999998888',
  remetenteNome: 'Fulano',
  tipo: 'text',
  conteudo: 'oi',
  mensagemEm: '2026-09-10T00:00:00.000Z',
  phoneNumberId: 'PN_1',
  displayPhoneNumber: '5511000000000',
  payloadBruto: { messaging_product: 'whatsapp' },
}

describe('persistirMensagensInbound', () => {
  it('grava com onConflict no whatsapp_message_id e ignoreDuplicates', async () => {
    const { client, chamadas } = fakeAdmin('nova')
    const r = await persistirMensagensInbound(client, [msgExemplo])
    expect(chamadas[0].onConflict).toBe('whatsapp_message_id')
    expect(chamadas[0].ignoreDuplicates).toBe(true)
    expect(chamadas[0].row.whatsapp_message_id).toBe('wamid.AAAA1111')
    expect(chamadas[0].row.direcao).toBe('inbound')
    expect(r).toEqual({ recebidas: 1, novas: 1, duplicadas: 0, erros: 0 })
  })

  it('reenvio da Meta (mesmo id) conta como duplicada, não nova', async () => {
    const { client } = fakeAdmin('duplicada')
    const r = await persistirMensagensInbound(client, [msgExemplo])
    expect(r).toEqual({ recebidas: 1, novas: 0, duplicadas: 1, erros: 0 })
  })

  it('erro de banco é contado, NÃO lançado (não pode virar retry da Meta)', async () => {
    const consoleErro = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client } = fakeAdmin('erro')
    const r = await persistirMensagensInbound(client, [msgExemplo])
    expect(r).toEqual({ recebidas: 1, novas: 0, duplicadas: 0, erros: 1 })
    consoleErro.mockRestore()
  })

  it('lista vazia → nada gravado', async () => {
    const { client, chamadas } = fakeAdmin('nova')
    const r = await persistirMensagensInbound(client, [])
    expect(chamadas).toHaveLength(0)
    expect(r).toEqual({ recebidas: 0, novas: 0, duplicadas: 0, erros: 0 })
  })
})
