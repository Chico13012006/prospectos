import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  extrairMensagensInbound,
  persistirMensagensInbound,
  resolverVinculoPorTelefone,
} from '../inbound'

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

// ── Persistência ────────────────────────────────────────────────────────────

// Cliente Supabase falso: atende `whatsapp_mensagens` (upsert().select()) e
// `leads` (select().not().limit(), thenable). O modo controla o resultado do
// upsert; `leads` controla o que a resolução de vínculo enxerga.
function fakeAdmin(
  modo: 'nova' | 'duplicada' | 'erro',
  leads: Array<{ id: string; organizacao_id: string; contato_telefone: string | null }> = [],
  leadsErro?: string,
) {
  const chamadas: { onConflict?: string; ignoreDuplicates?: boolean; row: Record<string, unknown> }[] = []
  const client = {
    from(tabela: string) {
      if (tabela === 'leads') {
        const resposta = leadsErro
          ? { data: null, error: { message: leadsErro } }
          : { data: leads, error: null }
        const builder: Record<string, unknown> = {
          select: () => builder,
          not: () => builder,
          limit: () => Promise.resolve(resposta),
        }
        return builder
      }
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
    expect(r).toEqual({
      recebidas: 1, novas: 1, duplicadas: 0, erros: 0,
      vinculadas: 0, semLead: 1, ambiguas: 0,
    })
  })

  it('reenvio da Meta (mesmo id) conta como duplicada, não nova', async () => {
    const { client } = fakeAdmin('duplicada')
    const r = await persistirMensagensInbound(client, [msgExemplo])
    expect(r).toEqual({
      recebidas: 1, novas: 0, duplicadas: 1, erros: 0,
      vinculadas: 0, semLead: 0, ambiguas: 0,
    })
  })

  it('erro de banco é contado, NÃO lançado (não pode virar retry da Meta)', async () => {
    const consoleErro = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client } = fakeAdmin('erro')
    const r = await persistirMensagensInbound(client, [msgExemplo])
    expect(r).toEqual({
      recebidas: 1, novas: 0, duplicadas: 0, erros: 1,
      vinculadas: 0, semLead: 0, ambiguas: 0,
    })
    consoleErro.mockRestore()
  })

  it('lista vazia → nada gravado', async () => {
    const { client, chamadas } = fakeAdmin('nova')
    const r = await persistirMensagensInbound(client, [])
    expect(chamadas).toHaveLength(0)
    expect(r).toEqual({
      recebidas: 0, novas: 0, duplicadas: 0, erros: 0,
      vinculadas: 0, semLead: 0, ambiguas: 0,
    })
  })
})

// ── Vínculo com lead pelo telefone ──────────────────────────────────────────

const ORG_LAUDOS = '03097614-9fd5-4491-a91c-589f84461683'

describe('resolverVinculoPorTelefone', () => {
  it('CASO REAL Laudos com 1 lead: 5511991532368 casa 11991532368 -> vinculado', async () => {
    const { client } = fakeAdmin('nova', [
      { id: 'L1', organizacao_id: ORG_LAUDOS, contato_telefone: '11991532368' },
    ])
    const r = await resolverVinculoPorTelefone(client, '5511991532368')
    expect(r).toEqual({ status: 'vinculado', leadId: 'L1', organizacaoId: ORG_LAUDOS })
  })

  it('telefone com máscara na base casa com o remetente sem máscara', async () => {
    const { client } = fakeAdmin('nova', [
      { id: 'L1', organizacao_id: ORG_LAUDOS, contato_telefone: '+55 (11) 99153-2368' },
    ])
    expect(await resolverVinculoPorTelefone(client, '5511991532368')).toMatchObject({
      status: 'vinculado', leadId: 'L1',
    })
  })

  it('nenhum lead com telefone equivalente -> sem_lead', async () => {
    const { client } = fakeAdmin('nova', [
      { id: 'L1', organizacao_id: ORG_LAUDOS, contato_telefone: '11999990000' },
      { id: 'L2', organizacao_id: ORG_LAUDOS, contato_telefone: null },
    ])
    expect(await resolverVinculoPorTelefone(client, '5511991532368')).toEqual({ status: 'sem_lead' })
  })

  it('CASO REAL Laudos como está hoje: 3 leads com o MESMO telefone -> ambiguo', async () => {
    const { client } = fakeAdmin('nova', [
      { id: 'L1', organizacao_id: ORG_LAUDOS, contato_telefone: '11991532368' },
      { id: 'L2', organizacao_id: ORG_LAUDOS, contato_telefone: '11991532368' },
      { id: 'L3', organizacao_id: ORG_LAUDOS, contato_telefone: '5511991532368' },
    ])
    const r = await resolverVinculoPorTelefone(client, '5511991532368')
    expect(r.status).toBe('ambiguo')
    if (r.status === 'ambiguo') {
      expect([...r.leadIds].sort()).toEqual(['L1', 'L2', 'L3'])
      expect(r.organizacaoIds).toEqual([ORG_LAUDOS])
    }
  })

  it('ambiguidade entre organizações diferentes também -> ambiguo', async () => {
    const { client } = fakeAdmin('nova', [
      { id: 'L1', organizacao_id: 'org-a', contato_telefone: '11991532368' },
      { id: 'L2', organizacao_id: 'org-b', contato_telefone: '5511991532368' },
    ])
    const r = await resolverVinculoPorTelefone(client, '5511991532368')
    expect(r.status).toBe('ambiguo')
    if (r.status === 'ambiguo') expect([...r.organizacaoIds].sort()).toEqual(['org-a', 'org-b'])
  })

  it('erro ao ler leads -> status erro', async () => {
    const consoleErro = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client } = fakeAdmin('nova', [], 'db down')
    expect(await resolverVinculoPorTelefone(client, '5511991532368')).toEqual({ status: 'erro' })
    consoleErro.mockRestore()
  })
})

describe('persistirMensagensInbound + vínculo', () => {
  const inbound = {
    whatsappMessageId: 'wamid.REAL1',
    remetente: '5511991532368',
    remetenteNome: 'Cliente Laudos',
    tipo: 'text',
    conteudo: 'oi, é sobre o laudo',
    mensagemEm: '2026-09-10T00:00:00.000Z',
    phoneNumberId: 'PN_1',
    displayPhoneNumber: '5511000000000',
    payloadBruto: { messaging_product: 'whatsapp' },
  }

  it('1 lead -> grava lead_id e organizacao_id do lead na mensagem', async () => {
    const { client, chamadas } = fakeAdmin('nova', [
      { id: 'L1', organizacao_id: ORG_LAUDOS, contato_telefone: '11991532368' },
    ])
    const r = await persistirMensagensInbound(client, [inbound])
    expect(chamadas[0].row.lead_id).toBe('L1')
    expect(chamadas[0].row.organizacao_id).toBe(ORG_LAUDOS)
    expect(r).toMatchObject({ recebidas: 1, novas: 1, vinculadas: 1, semLead: 0, ambiguas: 0 })
  })

  it('múltiplos leads -> mensagem SEM lead_id/organizacao_id + contador ambiguas', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { client, chamadas } = fakeAdmin('nova', [
      { id: 'L1', organizacao_id: ORG_LAUDOS, contato_telefone: '11991532368' },
      { id: 'L2', organizacao_id: ORG_LAUDOS, contato_telefone: '11991532368' },
    ])
    const r = await persistirMensagensInbound(client, [inbound])
    expect(chamadas[0].row).not.toHaveProperty('lead_id')
    expect(chamadas[0].row).not.toHaveProperty('organizacao_id')
    expect(r).toMatchObject({ novas: 1, vinculadas: 0, ambiguas: 1 })
    expect(consoleWarn).toHaveBeenCalled()
    consoleWarn.mockRestore()
  })

  it('nenhum lead -> mensagem gravada sem vínculo + contador semLead', async () => {
    const { client, chamadas } = fakeAdmin('nova', [
      { id: 'L1', organizacao_id: ORG_LAUDOS, contato_telefone: '11000000000' },
    ])
    const r = await persistirMensagensInbound(client, [inbound])
    expect(chamadas[0].row).not.toHaveProperty('lead_id')
    expect(r).toMatchObject({ novas: 1, semLead: 1, vinculadas: 0, ambiguas: 0 })
  })

  it('IDEMPOTÊNCIA: reenvio da Meta (mesmo id) -> duplicada, não re-vincula', async () => {
    const { client } = fakeAdmin('duplicada', [
      { id: 'L1', organizacao_id: ORG_LAUDOS, contato_telefone: '11991532368' },
    ])
    const r = await persistirMensagensInbound(client, [inbound])
    expect(r).toMatchObject({ recebidas: 1, novas: 0, duplicadas: 1, vinculadas: 0 })
  })

  it('erro ao ler leads não derruba a gravação — mensagem entra sem vínculo', async () => {
    const consoleErro = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client, chamadas } = fakeAdmin('nova', [], 'db down')
    const r = await persistirMensagensInbound(client, [inbound])
    expect(chamadas[0].row).not.toHaveProperty('lead_id')
    expect(r).toMatchObject({ novas: 1, vinculadas: 0, semLead: 0, ambiguas: 0 })
    consoleErro.mockRestore()
  })
})
