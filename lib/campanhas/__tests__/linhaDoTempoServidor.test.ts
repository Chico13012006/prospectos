import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buscarLinhaDoTempoCampanha } from '../linhaDoTempoServidor'

// Mock do query builder: acumula os filtros aplicados para que o teste possa
// provar o escopo de organização, e resolve como thenable (o módulo faz `await`
// direto no builder, como o resto do repositório).
class Query {
  eqCalls: [string, unknown][] = []
  inCalls: [string, unknown[]][] = []

  constructor(public table: string, private data: unknown[]) {}

  select() { return this }
  order() { return this }
  gte() { return this }
  eq(coluna: string, valor: unknown) { this.eqCalls.push([coluna, valor]); return this }
  in(coluna: string, valores: unknown[]) { this.inCalls.push([coluna, valores]); return this }
  then(resolve: (r: { data: unknown[]; error: null }) => unknown) {
    return Promise.resolve(resolve({ data: this.data, error: null }))
  }

  temEq(coluna: string, valor: unknown) { return this.eqCalls.some(([c, v]) => c === coluna && v === valor) }
}

const INICIO = '2026-09-07T19:21:00.000Z'

function criarClient(sobrescrever: Record<string, unknown[]> = {}) {
  const dados: Record<string, unknown[]> = {
    workflow_execucoes: [
      { id: 'ex-1', lead_id: 'lead-1', status: 'concluido', iniciado_em: INICIO },
      { id: 'ex-2', lead_id: 'lead-2', status: 'cancelado', iniciado_em: INICIO },
    ],
    leads: [
      { id: 'lead-1', empresa: 'Egoismo', contato_nome: 'Aline', contato_email: 'aline@exemplo.com' },
      { id: 'lead-2', empresa: '  ', contato_nome: null, contato_email: null },
    ],
    workflow_execucao_eventos: [
      {
        execucao_id: 'ex-1', tipo: 'email_enviado', criado_em: '2026-09-07T19:21:59.000Z',
        detalhe: { enviado: true, assunto: 'AGORA VAI' },
      },
      { execucao_id: 'ex-1', tipo: 'acao_executada', criado_em: '2026-09-07T19:22:00.000Z', detalhe: {} },
    ],
    interacoes: [
      {
        lead_id: 'lead-1', tipo: 'resposta', created_at: '2026-09-07T19:28:10.000Z',
        descricao: 'Te amo\n\nEm seg., 7 de set...\n> citação antiga',
      },
      {
        lead_id: 'lead-1', tipo: 'nota', created_at: '2026-09-07T19:28:12.000Z',
        descricao: 'Encaminhado ao closer (Francisco)',
      },
      // Ruído que NÃO pode virar evento: nota de sistema qualquer.
      {
        lead_id: 'lead-1', tipo: 'nota', created_at: '2026-09-07T19:29:00.000Z',
        descricao: 'Estágio normalizado automaticamente',
      },
    ],
    ...sobrescrever,
  }
  const queries: Query[] = []
  const client = {
    from(table: string) {
      const query = new Query(table, dados[table] ?? [])
      queries.push(query)
      return query
    },
  } as unknown as SupabaseClient
  return { client, queries }
}

describe('linha do tempo da campanha', () => {
  it('monta envio, resposta e aviso ao closer em ordem cronológica', async () => {
    const { client } = criarClient()
    const { destinatarios, totais } = await buscarLinhaDoTempoCampanha(client, 'org-a', 'camp-1')

    const primeiro = destinatarios[0]
    expect(primeiro.empresa).toBe('Egoismo')
    expect(primeiro.contato).toBe('Aline')
    expect(primeiro.enviadoEm).toBe('2026-09-07T19:21:59.000Z')
    expect(primeiro.respondeuEm).toBe('2026-09-07T19:28:10.000Z')
    expect(primeiro.closerAvisadoEm).toBe('2026-09-07T19:28:12.000Z')
    expect(primeiro.eventos.map((e) => e.tipo)).toEqual(['enviado', 'resposta', 'closer'])
    expect(primeiro.eventos[0].detalhe).toBe('AGORA VAI')
    // A citação do e-mail original não vai para a tela.
    expect(primeiro.eventos[1].detalhe).toBe('Te amo')

    expect(totais).toEqual({ publico: 2, enviados: 1, respostas: 1, falhas: 1, pendentes: 0 })
  })

  it('não credita interação anterior ao início da execução daquele lead', async () => {
    const { client } = criarClient({
      interacoes: [
        {
          lead_id: 'lead-1', tipo: 'resposta', created_at: '2026-08-24T11:04:00.000Z',
          descricao: 'Resposta de agosto, de outra conversa',
        },
      ],
    })
    const { destinatarios, totais } = await buscarLinhaDoTempoCampanha(client, 'org-a', 'camp-1')

    expect(destinatarios[0].respondeuEm).toBeNull()
    expect(destinatarios[0].eventos.map((e) => e.tipo)).toEqual(['enviado'])
    expect(totais.respostas).toBe(0)
  })

  it('marca envio recusado como não realizado, sem contar como enviado', async () => {
    const { client } = criarClient({
      workflow_execucao_eventos: [
        {
          execucao_id: 'ex-1', tipo: 'email_enviado', criado_em: '2026-09-07T19:21:59.000Z',
          detalhe: { enviado: false, assunto: 'AGORA VAI' },
        },
      ],
      interacoes: [],
    })
    const { destinatarios, totais } = await buscarLinhaDoTempoCampanha(client, 'org-a', 'camp-1')

    expect(destinatarios[0].enviadoEm).toBeNull()
    expect(destinatarios[0].eventos.map((e) => e.tipo)).toEqual(['nao_enviado'])
    expect(totais.enviados).toBe(0)
  })

  it('registra o cancelamento e usa rótulo neutro para lead sem empresa', async () => {
    const { client } = criarClient()
    const { destinatarios } = await buscarLinhaDoTempoCampanha(client, 'org-a', 'camp-1')

    const cancelado = destinatarios[1]
    expect(cancelado.empresa).toBe('Lead sem empresa')
    expect(cancelado.statusExecucao).toBe('cancelado')
    expect(cancelado.enviadoEm).toBeNull()
    expect(cancelado.eventos.map((e) => e.tipo)).toEqual(['cancelado'])
  })

  it('filtra todas as consultas pela organização da sessão', async () => {
    const { client, queries } = criarClient()
    await buscarLinhaDoTempoCampanha(client, 'org-a', 'camp-1')

    expect(queries.length).toBeGreaterThan(0)
    for (const query of queries) {
      expect(query.temEq('organizacao_id', 'org-a')).toBe(true)
      expect(query.temEq('organizacao_id', 'org-b')).toBe(false)
    }
    expect(queries.find((q) => q.table === 'workflow_execucoes')?.temEq('campanha_id', 'camp-1')).toBe(true)
  })

  it('campanha sem execuções não consulta leads, eventos nem interações', async () => {
    const { client, queries } = criarClient({ workflow_execucoes: [] })
    const resultado = await buscarLinhaDoTempoCampanha(client, 'org-a', 'camp-1')

    expect(resultado.destinatarios).toEqual([])
    expect(resultado.totais).toEqual({ publico: 0, enviados: 0, respostas: 0, falhas: 0, pendentes: 0 })
    expect(queries.map((q) => q.table)).toEqual(['workflow_execucoes'])
  })
})
