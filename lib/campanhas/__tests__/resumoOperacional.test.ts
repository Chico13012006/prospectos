import { describe, expect, it } from 'vitest'
import type { DefinicaoWorkflow } from '@/lib/workflows/types'
import {
  NAO_CONFIGURADO,
  extrairMensagensConfiguradas,
  formatarCadenciaOperacional,
  formatarMensagensOperacionais,
  formatarPublicoOperacional,
  formatarRegraResposta,
  formatarStatusOperacional,
  proximaAcaoOperacional,
} from '../resumoOperacional'

const DEFINICAO: DefinicaoWorkflow = {
  gatilho: { tipo: 'manual', config: {} },
  condicoes: [],
  acoes: [
    { id: 'a1', tipo: 'enviar_email', config: { template: 'reativacao_1' } },
    { id: 'a2', tipo: 'esperar', config: { dias: 2 } },
    {
      id: 'a3',
      tipo: 'ramificar',
      config: {
        condicao: { tipo: 'campo', config: {} },
        entao: [{ tipo: 'enviar_email', config: { template: 'reativacao_3' } }],
        senao: [{ tipo: 'enviar_whatsapp', config: { texto: 'Olá {nome}' } }],
      },
    },
  ],
}

describe('Resumo operacional de campanha', () => {
  it('usa somente recortes configurados do público e não inventa fallback', () => {
    expect(formatarPublicoOperacional(null)).toBe(NAO_CONFIGURADO)
    expect(formatarPublicoOperacional({})).toBe(NAO_CONFIGURADO)
    expect(formatarPublicoOperacional({
      empresas: { fonte: 'base', segmento: 'Hotelaria', cidades: 'Curitiba', pais: 'Brasil' },
      decisores: { departamento: 'Compras', senioridade: 'Diretoria' },
    })).toBe('Base de leads existente — Hotelaria · Curitiba · Brasil — Decisores: Compras · Diretoria')
  })

  it('extrai mensagens reais do workflow, inclusive dentro de ramificações', () => {
    expect(extrairMensagensConfiguradas(DEFINICAO)).toEqual([
      'E-mail — reativacao_1',
      'E-mail — reativacao_3',
      'WhatsApp — Olá {nome}',
    ])
    expect(formatarMensagensOperacionais(DEFINICAO)).toBe(
      '3 mensagens · E-mail — reativacao_1 · E-mail — reativacao_3 · WhatsApp — Olá {nome}',
    )
    expect(formatarMensagensOperacionais(null)).toBe(NAO_CONFIGURADO)
  })

  it('resume a cadência a partir do workflow e da agenda persistidos', () => {
    expect(formatarCadenciaOperacional(
      { id: 'wf-1', nome: 'Reativação', status: 'publicado', definicao: DEFINICAO },
      { diasSemana: ['seg', 'qua', 'sex'], horarioInicio: '09:00', horarioFim: '18:00', limiteDiario: 40 },
    )).toBe('Reativação · 3 etapas · Seg, Qua, Sex · 09:00–18:00 · 40/dia')
    expect(formatarCadenciaOperacional(null, undefined)).toBe(NAO_CONFIGURADO)
  })

  it('distingue regra ausente, parar e continuar após resposta', () => {
    expect(formatarRegraResposta(undefined)).toBe(NAO_CONFIGURADO)
    expect(formatarRegraResposta(true)).toBe('Parar ao receber resposta')
    expect(formatarRegraResposta(false)).toBe('Continuar após resposta')
  })

  it('deriva status e próxima ação somente de estado, dry-run e workflow reais', () => {
    expect(formatarStatusOperacional('ativa', true)).toBe('Ativa · Modo ensaio')
    expect(formatarStatusOperacional('ativa', false)).toBe('Ativa · Envio real')
    expect(proximaAcaoOperacional('rascunho', true, null)).toBe('Configurar cadência')
    expect(proximaAcaoOperacional('rascunho', true, 'wf-1')).toBe('Revisar e publicar em modo ensaio')
    expect(proximaAcaoOperacional('ativa', true, 'wf-1')).toBe('Revisar ensaio e ativar envio real')
    expect(proximaAcaoOperacional('ativa', false, 'wf-1')).toBe('Pausar ou concluir campanha')
    expect(proximaAcaoOperacional('pausada', true, 'wf-1')).toBe('Retomar ou concluir campanha')
    expect(proximaAcaoOperacional('concluida', false, 'wf-1')).toBe('Nenhuma ação pendente')
  })
})
