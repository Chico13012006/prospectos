import { describe, expect, it } from 'vitest'
import type { Lead } from '@/lib/engine/types'
import {
  descreverReuniao,
  escolherTemplateEtapa,
  ESTAGIO_DESTINO_POR_COLUNA,
  materializarMensagemEtapa,
  validarReuniao,
  type TemplateEtapa,
} from '../mensagemEtapa'
import { COLUNAS_KANBAN } from '@/lib/pipeline-stages'

const tpl = (p: Partial<TemplateEtapa>): TemplateEtapa => ({
  id: 't', nome: 'T', nicho: null, assunto: 'Assunto', corpo: 'Corpo', html: null, created_at: '2026-09-01', ...p,
})

describe('colunas do Kanban', () => {
  it('toda coluna do Kanban tem estágio de destino, e ele pertence à coluna', () => {
    for (const col of COLUNAS_KANBAN) {
      expect(col.estagios).toContain(ESTAGIO_DESTINO_POR_COLUNA[col.id])
    }
  })
})

describe('validarReuniao', () => {
  it('aceita data e hora válidas e descreve no formato brasileiro', () => {
    const r = validarReuniao({ data: '2026-09-30', hora: '14:05' })
    expect(r).toEqual({ ok: true, valor: { data: '2026-09-30', hora: '14:05' } })
    if (r.ok) expect(descreverReuniao(r.valor)).toBe('30/09/2026 às 14:05')
  })

  it('recusa ausente, data impossível e hora fora do relógio', () => {
    expect(validarReuniao(undefined).ok).toBe(false)
    expect(validarReuniao({ data: '2026-09-30' }).ok).toBe(false)
    expect(validarReuniao({ data: '2026-02-30', hora: '10:00' }).ok).toBe(false)
    expect(validarReuniao({ data: '30/09/2026', hora: '10:00' }).ok).toBe(false)
    expect(validarReuniao({ data: '2026-09-30', hora: '24:00' }).ok).toBe(false)
    expect(validarReuniao({ data: '2026-09-30', hora: '9:00' }).ok).toBe(false)
  })
})

describe('escolherTemplateEtapa', () => {
  const generico = tpl({ id: 'g', nicho: null })
  const hotel = tpl({ id: 'h', nicho: 'hotelaria' })

  it('prefere a variante do nicho do lead', () => {
    expect(escolherTemplateEtapa([generico, hotel], { id: 'L1', segmento: 'Hotelaria' })?.id).toBe('h')
  })

  it('sem variante do nicho, usa a genérica; sem nenhuma, null', () => {
    expect(escolherTemplateEtapa([generico, hotel], { id: 'L1', segmento: 'Buffet' })?.id).toBe('g')
    expect(escolherTemplateEtapa([hotel], { id: 'L1', segmento: 'Buffet' })).toBeNull()
    expect(escolherTemplateEtapa([], { id: 'L1', segmento: null })).toBeNull()
  })

  it('com várias variantes, a escolha é estável para o mesmo lead', () => {
    const lista = [tpl({ id: 'a' }), tpl({ id: 'b', created_at: '2026-09-02' }), tpl({ id: 'c', created_at: '2026-09-03' })]
    const primeira = escolherTemplateEtapa(lista, { id: 'lead-x', segmento: null })?.id
    expect(escolherTemplateEtapa([...lista].reverse(), { id: 'lead-x', segmento: null })?.id).toBe(primeira)
  })
})

describe('materializarMensagemEtapa', () => {
  const lead = { id: 'L1', empresa: 'Hotel Sol', contato_nome: 'Ana Lima', segmento: 'Hotelaria' } as unknown as Lead
  const extras = { data_reuniao: '30/09/2026', hora_reuniao: '14:00', nome_servico: 'Laudo' }

  it('preenche variáveis do lead e da reunião no e-mail', () => {
    const m = materializarMensagemEtapa(
      tpl({ assunto: 'Reunião {{data_reuniao}}', corpo: 'Olá {{nome}}, até {{data_reuniao}} às {{hora_reuniao}} — {{empresa}}' }),
      'email', lead, extras,
    )
    expect(m.assunto).toBe('Reunião 30/09/2026')
    expect(m.texto).toBe('Olá Ana, até 30/09/2026 às 14:00 — Hotel Sol')
    expect(m.pendentes).toEqual([])
  })

  it('WhatsApp é texto puro, sem assunto nem HTML', () => {
    const m = materializarMensagemEtapa(tpl({ assunto: 'x', corpo: 'Oi {nome}', html: '<p>x</p>' }), 'whatsapp', lead, extras)
    expect(m).toMatchObject({ assunto: null, html: null, texto: 'Oi Ana' })
  })

  it('aponta variável que não dá para preencher (inclusive no HTML)', () => {
    const semReuniao = materializarMensagemEtapa(tpl({ corpo: 'Dia {{data_reuniao}}' }), 'email', lead, { nome_servico: 'Laudo' })
    expect(semReuniao.pendentes).toEqual(['data_reuniao'])
    const noHtml = materializarMensagemEtapa(tpl({ corpo: 'ok', html: '<p>{{cupom}}</p><style>a{color:red}</style>' }), 'email', lead, extras)
    expect(noHtml.pendentes).toEqual(['cupom'])
  })
})
