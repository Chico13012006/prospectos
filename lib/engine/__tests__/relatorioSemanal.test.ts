import { describe, it, expect } from 'vitest'
import { montarEmailRelatorio, type RelatorioKpis } from '../relatorioSemanal'

const kpis: RelatorioKpis = {
  novos: 12, respostas: 4, reunioes: 2, ganhos: 1, totalBase: 520,
  periodoInicio: '02/08/2026', periodoFim: '09/08/2026',
}

describe('relatório semanal — montarEmailRelatorio (item 7)', () => {
  it('assunto traz o período', () => {
    expect(montarEmailRelatorio(kpis).assunto).toContain('02/08/2026 a 09/08/2026')
  })
  it('texto lista os 4 KPIs da semana + base total', () => {
    const { corpoTexto } = montarEmailRelatorio(kpis)
    expect(corpoTexto).toContain('Leads novos: 12')
    expect(corpoTexto).toContain('Respostas recebidas: 4')
    expect(corpoTexto).toContain('Reuniões agendadas: 2')
    expect(corpoTexto).toContain('Conversões (Ganho): 1')
    expect(corpoTexto).toContain('Base total: 520')
  })
  it('HTML embute os números (renderiza o card)', () => {
    const { corpoHtml } = montarEmailRelatorio(kpis)
    expect(corpoHtml).toContain('>12<')
    expect(corpoHtml).toContain('Conversões (Ganho)')
  })
})
