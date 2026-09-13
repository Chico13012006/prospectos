import { describe, expect, it } from 'vitest'
import {
  agruparVencimentosPorCliente,
  filtroResponsavelDashboard,
  parearCiclosRenovados,
  podeVerDashboardDaEquipe,
  resumirInteracoesProspeccao,
  resumirEmpresasVencimento,
  serieTemporal,
  situacaoRenovacao,
  statusVencimento,
  variacaoPercentual,
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

  it('pareia cada ciclo renovado com a validade do ciclo seguinte', () => {
    expect(parearCiclosRenovados([
      { id: 'a1', leadId: 'lead-a', validadeEm: '2025-09-01', renovadoEm: '2025-08-20T10:00:00Z', criadoEm: '2025-01-01T10:00:00Z' },
      { id: 'a2', leadId: 'lead-a', validadeEm: '2026-09-01', renovadoEm: '2026-08-22T10:00:00Z', criadoEm: '2025-08-20T10:00:01Z' },
      { id: 'a3', leadId: 'lead-a', validadeEm: '2027-09-01', renovadoEm: null, criadoEm: '2026-08-22T10:00:01Z' },
      { id: 'b1', leadId: 'lead-b', validadeEm: '2026-03-10', renovadoEm: '2026-03-01T10:00:00Z', criadoEm: '2025-03-01T10:00:00Z' },
    ])).toEqual([
      {
        id: 'a2',
        leadId: 'lead-a',
        validadeAnterior: '2026-09-01',
        novaValidade: '2027-09-01',
        renovadoEm: '2026-08-22T10:00:00Z',
      },
      {
        id: 'b1',
        leadId: 'lead-b',
        validadeAnterior: '2026-03-10',
        novaValidade: null,
        renovadoEm: '2026-03-01T10:00:00Z',
      },
      {
        id: 'a1',
        leadId: 'lead-a',
        validadeAnterior: '2025-09-01',
        novaValidade: '2026-09-01',
        renovadoEm: '2025-08-20T10:00:00Z',
      },
    ])
  })

  it('calcula variação e série temporal sem inventar pontos fora da janela', () => {
    expect(variacaoPercentual(4, 2)).toBe(100)
    expect(variacaoPercentual(1, 0)).toBe(100)
    expect(variacaoPercentual(0, 0)).toBe(0)
    expect(variacaoPercentual(1, 2)).toBe(-50)
    expect(serieTemporal([
      '2026-08-01T00:00:00Z',
      '2026-08-05T00:00:00Z',
      '2026-08-09T23:59:59Z',
      '2026-08-10T00:00:00Z',
    ], new Date('2026-08-01T00:00:00Z'), new Date('2026-08-10T00:00:00Z'), 3)).toEqual([1, 1, 1])
  })

  it('resume follow-ups, nichos e respostas por região a partir das interações reais', () => {
    const interacao = (
      id: string,
      leadId: string,
      tipo: string,
      criadaEm: string,
      segmento: string | null,
      estado: string | null,
      canal = 'email',
      origemAcao = tipo === 'resposta' ? 'humano' : 'ia',
    ) => ({ id, leadId, tipo, canal, origemAcao, criadaEm, segmento, estado })

    const resumo = resumirInteracoesProspeccao([
      interacao('a0', 'lead-a', 'abordagem', '2026-08-04T10:00:00Z', 'Buffet', 'SP'),
      interacao('a1', 'lead-a', 'follow_up', '2026-08-05T10:00:00Z', 'Buffet', 'SP'),
      interacao('a2', 'lead-a', 'resposta', '2026-08-06T10:00:00Z', 'Buffet', 'SP'),
      interacao('b1', 'lead-b', 'abordagem', '2026-08-07T10:00:00Z', 'Varejo', 'RJ'),
      interacao('b2', 'lead-b', 'follow_up', '2026-08-08T10:00:00Z', 'Varejo', 'RJ'),
      interacao('c1', 'lead-c', 'resposta', '2026-08-09T10:00:00Z', null, null),
      interacao('antigo-0', 'lead-z', 'abordagem', '2026-07-09T10:00:00Z', 'Serviços', 'MG'),
      interacao('antigo', 'lead-z', 'follow_up', '2026-07-10T10:00:00Z', 'Serviços', 'MG'),
    ], new Date('2026-07-01T00:00:00Z'), new Date('2026-08-01T00:00:00Z'), new Date('2026-09-01T00:00:00Z'))

    expect(resumo.followUps).toMatchObject({
      clientes: 2,
      clientesAnteriores: 1,
      retornos: 1,
      retornosAnteriores: 0,
    })
    expect(resumo.followUps.serie.reduce((total, ponto) => total + ponto, 0)).toBe(2)
    expect(resumo.nichos).toEqual([
      { nome: 'Buffet', quantidade: 1, percentual: 50 },
      { nome: 'Varejo', quantidade: 1, percentual: 50 },
    ])
    expect(resumo.respostasPorNichoRegiao).toEqual([
      { nome: 'Buffet · SP', quantidade: 1, percentual: 50 },
      { nome: 'Sem nicho · Sem UF', quantidade: 1, percentual: 50 },
    ])
  })

  it('usa a mesma classificação da Cadência para clientes ativos e respondidos', () => {
    const interacoes = [
      { id: 'a1', leadId: 'lead-a', tipo: 'nota', canal: 'email', origemAcao: 'ia', criadaEm: '2026-07-10T10:00:00Z', segmento: 'Buffet', estado: 'SP' },
      { id: 'c1', leadId: 'lead-c', tipo: 'nota', canal: 'email', origemAcao: 'ia', criadaEm: '2026-07-12T10:00:00Z', segmento: 'Varejo', estado: 'RJ' },
      { id: 'a2', leadId: 'lead-a', tipo: 'nota', canal: 'email', origemAcao: 'ia', criadaEm: '2026-08-02T10:00:00Z', segmento: 'Buffet', estado: 'SP' },
      { id: 'b1', leadId: 'lead-b', tipo: 'nota', canal: 'email', origemAcao: 'ia', criadaEm: '2026-08-03T10:00:00Z', segmento: 'Serviços', estado: 'MG' },
      { id: 'sistema', leadId: 'lead-b', tipo: 'nota', canal: 'sistema', origemAcao: 'sistema', criadaEm: '2026-08-03T11:00:00Z', segmento: 'Serviços', estado: 'MG' },
      { id: 'c2', leadId: 'lead-c', tipo: 'resposta', canal: 'email', origemAcao: 'humano', criadaEm: '2026-08-04T10:00:00Z', segmento: 'Varejo', estado: 'RJ' },
    ]
    const leadsCadencia = [
      { leadId: 'lead-a', estagio: 'aguardando_resposta', inscritoEm: '2026-07-09T10:00:00Z' },
      { leadId: 'lead-b', estagio: 'primeiro_contato', inscritoEm: '2026-08-01T10:00:00Z' },
      { leadId: 'lead-c', estagio: 'respondeu', inscritoEm: '2026-07-11T10:00:00Z' },
    ]

    const resumo = resumirInteracoesProspeccao(
      interacoes,
      new Date('2026-07-01T00:00:00Z'),
      new Date('2026-08-01T00:00:00Z'),
      new Date('2026-09-01T00:00:00Z'),
      leadsCadencia,
    )

    expect(resumo.followUps).toMatchObject({
      clientes: 2,
      clientesAnteriores: 2,
      retornos: 1,
      retornosAnteriores: 0,
    })
    expect(resumo.followUps.serie.reduce((total, ponto) => total + ponto, 0)).toBe(1)
    expect(resumo.nichos).toEqual([
      { nome: 'Buffet', quantidade: 1, percentual: 50 },
      { nome: 'Serviços', quantidade: 1, percentual: 50 },
    ])
  })
})
