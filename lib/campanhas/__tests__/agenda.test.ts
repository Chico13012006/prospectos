import { describe, expect, it } from 'vitest'
import {
  agendaPermiteProcessar,
  diaCampanhaEmFuso,
  normalizarDiasCampanha,
  publicoComDiasAtualizados,
  validarDiasCampanha,
} from '../agenda'

describe('agenda de campanha', () => {
  it('normaliza, remove duplicados e mantém a ordem semanal canônica', () => {
    expect(normalizarDiasCampanha(['sex', 'seg', 'sex', 'invalido'])).toEqual(['seg', 'sex'])
  })

  it('exige ao menos um dia válido ao salvar', () => {
    expect(() => validarDiasCampanha([])).toThrow(/ao menos um dia/i)
    expect(() => validarDiasCampanha(['segunda'])).toThrow(/dia inválido/i)
  })

  it('avalia o dia no fuso de São Paulo, inclusive na borda UTC', () => {
    // Já é segunda-feira em UTC, mas ainda é domingo em São Paulo.
    const instante = '2026-08-24T01:30:00.000Z'
    expect(diaCampanhaEmFuso(instante)).toBe('dom')
    expect(agendaPermiteProcessar(['dom'], instante)).toBe(true)
    expect(agendaPermiteProcessar(['seg'], instante)).toBe(false)
  })

  it('preserva o comportamento de campanhas legadas sem agenda, mas bloqueia agenda inválida', () => {
    expect(agendaPermiteProcessar(undefined, '2026-08-23T15:00:00.000Z')).toBe(true)
    expect(agendaPermiteProcessar([], '2026-08-23T15:00:00.000Z')).toBe(false)
  })

  it('troca somente os dias e preserva o restante do público e da agenda', () => {
    const publico = publicoComDiasAtualizados({
      objetivo: 'prospeccao',
      selecao: { leadIds: ['lead-1'] },
      agenda: { diasSemana: ['seg'], horarioInicio: '09:00', limiteDiario: 20 },
    }, ['dom', 'ter'])

    expect(publico).toEqual({
      objetivo: 'prospeccao',
      selecao: { leadIds: ['lead-1'] },
      agenda: { diasSemana: ['dom', 'ter'], horarioInicio: '09:00', limiteDiario: 20 },
    })
  })
})
