import { describe, expect, it } from 'vitest'
import {
  agruparVencimentosPorCliente,
  filtroResponsavelDashboard,
  podeVerDashboardDaEquipe,
  resumirEmpresasVencimento,
  situacaoRenovacao,
  statusVencimento,
} from '../dashboard'

const hoje = new Date('2026-08-25T12:00:00.000Z')

describe('dashboard operacional', () => {
  it('agrupa múltiplos laudos no mesmo cliente e prioriza o mais urgente', () => {
    const grupos = agruparVencimentosPorCliente([
      { id: 'b', fonte: 'servico', leadId: 'l1', empresaId: 'e1', empresa: 'Cliente A', tipo: 'LTCAT', vencimentoEm: '2026-09-20' },
      { id: 'a', fonte: 'servico', leadId: 'l1', empresaId: 'e1', empresa: 'Cliente A', tipo: 'PGR', vencimentoEm: '2026-08-20' },
      { id: 'c', fonte: 'lead_legado', leadId: 'l2', empresaId: null, empresa: 'Cliente B', tipo: 'Laudo', vencimentoEm: '2026-08-30' },
    ], hoje)

    expect(grupos).toHaveLength(2)
    expect(grupos[0]).toMatchObject({ empresa: 'Cliente A', diasRestantes: -5, status: 'vencido' })
    expect(grupos[0].motivos.map((m) => m.tipo)).toEqual(['PGR', 'LTCAT'])
    expect(grupos[1]).toMatchObject({ empresa: 'Cliente B', diasRestantes: 5, status: 'critico' })
  })

  it('ignora datas inválidas e respeita o limite de clientes', () => {
    const grupos = agruparVencimentosPorCliente([
      { id: 'a', fonte: 'lead_legado', leadId: '1', empresaId: null, empresa: 'A', tipo: 'Laudo', vencimentoEm: 'inválida' },
      { id: 'b', fonte: 'lead_legado', leadId: '2', empresaId: null, empresa: 'B', tipo: 'Laudo', vencimentoEm: '2026-09-01' },
      { id: 'c', fonte: 'lead_legado', leadId: '3', empresaId: null, empresa: 'C', tipo: 'Laudo', vencimentoEm: '2026-09-02' },
    ], hoje, 1)
    expect(grupos.map((g) => g.empresa)).toEqual(['B'])
  })

  it('classifica as faixas de prioridade', () => {
    expect(statusVencimento(-1)).toBe('vencido')
    expect(statusVencimento(7)).toBe('critico')
    expect(statusVencimento(30)).toBe('atencao')
    expect(statusVencimento(31)).toBe('no_prazo')
  })

  it('resume as janelas por empresa sem duplicar múltiplos laudos', () => {
    const resumo = resumirEmpresasVencimento([
      { id: 'a1', fonte: 'servico', leadId: 'l1', empresaId: 'e1', empresa: 'A', tipo: 'PGR', vencimentoEm: '2026-09-01' },
      { id: 'a2', fonte: 'servico', leadId: 'l1', empresaId: 'e1', empresa: 'A', tipo: 'LTCAT', vencimentoEm: '2026-09-15' },
      { id: 'b', fonte: 'lead_legado', leadId: 'l2', empresaId: null, empresa: 'B', tipo: 'Laudo', vencimentoEm: '2026-10-10' },
      { id: 'c', fonte: 'lead_legado', leadId: 'l3', empresaId: null, empresa: 'C', tipo: 'Laudo', vencimentoEm: '2026-08-20' },
    ], hoje)

    expect(resumo).toEqual({
      vencidas: 1,
      proximos30: 1,
      entre31e60: 1,
      proximos60: 2,
      totalMonitoradas: 3,
    })
  })

  it('classifica a empresa pela validade mais urgente para manter faixas exclusivas', () => {
    const resumo = resumirEmpresasVencimento([
      { id: 'vencido', fonte: 'servico', leadId: 'l1', empresaId: 'e1', empresa: 'A', tipo: 'PGR', vencimentoEm: '2026-08-20' },
      { id: 'futuro', fonte: 'servico', leadId: 'l1', empresaId: 'e1', empresa: 'A', tipo: 'LTCAT', vencimentoEm: '2026-09-10' },
    ], hoje)

    expect(resumo).toMatchObject({ vencidas: 1, proximos30: 0, entre31e60: 0 })
  })

  it('não apresenta execução sem envio como comunicação realizada', () => {
    expect(situacaoRenovacao({ execucaoStatus: 'aguardando' })).toBe('agendado')
    expect(situacaoRenovacao({ execucaoStatus: 'erro' })).toBe('erro')
    expect(situacaoRenovacao({ execucaoStatus: 'concluido' })).toBe('encerrado')
    expect(situacaoRenovacao({})).toBe('nao_comunicado')
  })

  it('distingue envio realizado, follow-up ativo e resposta do ciclo atual', () => {
    expect(situacaoRenovacao({
      execucaoStatus: 'aguardando',
      execucaoIniciadaEm: '2026-08-20T10:00:00.000Z',
      ultimaMensagemEm: '2026-08-20T10:01:00.000Z',
    })).toBe('em_acompanhamento')
    expect(situacaoRenovacao({
      execucaoStatus: 'concluido',
      execucaoIniciadaEm: '2026-08-20T10:00:00.000Z',
      ultimaMensagemEm: '2026-08-20T10:01:00.000Z',
    })).toBe('enviado')
    expect(situacaoRenovacao({
      execucaoStatus: 'aguardando',
      execucaoIniciadaEm: '2026-08-20T10:00:00.000Z',
      ultimaMensagemEm: '2026-08-20T10:01:00.000Z',
      ultimaRespostaEm: '2026-08-20T11:00:00.000Z',
    })).toBe('respondido')
  })

  it('não atribui uma resposta antiga ao ciclo atual de renovação', () => {
    expect(situacaoRenovacao({
      execucaoStatus: 'aguardando',
      execucaoIniciadaEm: '2026-08-20T10:00:00.000Z',
      ultimaMensagemEm: '2026-08-20T10:01:00.000Z',
      ultimaRespostaEm: '2026-08-10T11:00:00.000Z',
    })).toBe('em_acompanhamento')
  })

  it('restringe o comercial à própria carteira e preserva o fallback legado por nome', () => {
    expect(podeVerDashboardDaEquipe('admin')).toBe(true)
    expect(podeVerDashboardDaEquipe('usuario')).toBe(false)
    expect(filtroResponsavelDashboard('usuario-1', 'Silmara')).toBe(
      'responsavel_id.eq.usuario-1,and(responsavel_id.is.null,responsavel_nome.ilike."Silmara%")',
    )
  })

  it('escapa nomes antes de compor o filtro PostgREST', () => {
    expect(filtroResponsavelDashboard('usuario-1', 'Ana "SDR" \\ Sul')).toBe(
      'responsavel_id.eq.usuario-1,and(responsavel_id.is.null,responsavel_nome.ilike."Ana \\"SDR\\" \\\\ Sul%")',
    )
  })
})
