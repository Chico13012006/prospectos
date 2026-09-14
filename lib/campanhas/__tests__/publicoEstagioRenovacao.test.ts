// Seleção de público com o estágio `renovacao`: campanhas comuns de follow-up
// não o alcançam; a campanha de renovação continua escolhendo pela validade.
// Banco falso em memória que aplica os filtros de verdade (eq/in/is/not/lte),
// para o teste provar o resultado da consulta e não só a chamada.
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { processarRenovacoes } from '@/lib/renovacao/processar'
import { aplicarRegraPublicoPorTipo, GRUPOS_STATUS_PUBLICO, regraPublicoCampanha } from '../configuracaoGuiada'
import { buscarPreviaPublicoCampanha } from '../publicoServidor'

type Linha = Record<string, unknown>

class ConsultaFalsa {
  private filtros: Array<(linha: Linha) => boolean> = []
  private unica = false
  private limite: number | null = null

  constructor(private readonly tabela: string, private readonly linhas: Linha[], private readonly escritas: string[]) {}

  select() { return this }
  insert() { this.escritas.push(`insert:${this.tabela}`); return this }
  update() { this.escritas.push(`update:${this.tabela}`); return this }
  upsert() { this.escritas.push(`upsert:${this.tabela}`); return this }
  delete() { this.escritas.push(`delete:${this.tabela}`); return this }
  eq(coluna: string, valor: unknown) { this.filtros.push((l) => l[coluna] === valor); return this }
  neq(coluna: string, valor: unknown) { this.filtros.push((l) => l[coluna] !== valor); return this }
  in(coluna: string, valores: unknown[]) { this.filtros.push((l) => valores.includes(l[coluna])); return this }
  is(coluna: string, valor: unknown) { this.filtros.push((l) => (valor === null ? l[coluna] == null : l[coluna] === valor)); return this }
  not(coluna: string, operador: string, valor: unknown) {
    if (operador === 'is' && valor === null) this.filtros.push((l) => l[coluna] != null)
    return this
  }
  lte(coluna: string, valor: string) { this.filtros.push((l) => typeof l[coluna] === 'string' && (l[coluna] as string) <= valor); return this }
  gte(coluna: string, valor: string) { this.filtros.push((l) => typeof l[coluna] === 'string' && (l[coluna] as string) >= valor); return this }
  or() { return this }
  order() { return this }
  limit(n: number) { this.limite = n; return this }
  maybeSingle() { this.unica = true; return this }
  single() { this.unica = true; return this }
  then(resolve: (resultado: { data: unknown; error: null }) => void) {
    const filtradas = this.linhas.filter((l) => this.filtros.every((filtro) => filtro(l)))
    const limitadas = this.limite === null ? filtradas : filtradas.slice(0, this.limite)
    resolve({ data: this.unica ? (limitadas[0] ?? null) : limitadas, error: null })
  }
}

const ORG = 'org-com-renovacao'
const OUTRA_ORG = 'org-outra'

function isoEmDias(dias: number): string {
  const data = new Date()
  data.setUTCDate(data.getUTCDate() + dias)
  return data.toISOString().slice(0, 10)
}

function lead(id: string, patch: Linha = {}): Linha {
  return {
    id,
    organizacao_id: ORG,
    empresa_id: null,
    empresa: `Empresa ${id}`,
    segmento: 'Buffet infantil',
    estagio: 'primeiro_contato',
    contato_nome: `Contato ${id}`,
    contato_email: `${id}@cliente.com.br`,
    responsavel_id: 'responsavel-1',
    owner: 'engine',
    optout: false,
    bounced: false,
    perdido: false,
    data_validade: null,
    created_at: '2026-09-12T00:00:00.000Z',
    ...patch,
  }
}

function bancoFalso(extras: Linha[] = []) {
  const tabelas: Record<string, Linha[]> = {
    organizacoes: [
      { id: ORG, configuracoes: { features: { estagioRenovacaoPorValidade: true }, renovacao: { antecedenciaDias: 45 } } },
      { id: OUTRA_ORG, configuracoes: {} },
    ],
    servicos_recorrentes: [],
    oportunidades: [],
    workflow_execucoes: [],
    tarefas: [],
    leads: [
      lead('renovacao-na-janela', { estagio: 'renovacao', data_validade: isoEmDias(10) }),
      lead('renovacao-futura', { estagio: 'renovacao', data_validade: isoEmDias(120) }),
      lead('primeiro-contato', { estagio: 'primeiro_contato' }),
      lead('em-follow-up', { estagio: 'follow_up' }),
      lead('outra-org-com-validade', { organizacao_id: OUTRA_ORG, estagio: 'renovacao', data_validade: isoEmDias(5) }),
      ...extras,
    ],
  }
  const escritas: string[] = []
  const client = {
    from: (tabela: string) => new ConsultaFalsa(tabela, tabelas[tabela] ?? [], escritas),
  } as unknown as SupabaseClient
  return { client, escritas }
}

describe('campanha comum de follow-up não alcança clientes em renovacao', () => {
  it('a regra do público de follow-up não aceita renovacao, nem vinda do payload', () => {
    expect(GRUPOS_STATUS_PUBLICO.flatMap((grupo) => [...grupo.estagios])).not.toContain('renovacao')
    expect(regraPublicoCampanha('followup').estagios).not.toContain('renovacao')
    const publico = aplicarRegraPublicoPorTipo({ selecao: { modo: 'filtros', estagios: ['renovacao'] } }, 'followup')
    expect(publico.selecao?.estagios?.length).toBeGreaterThan(0)
    expect(publico.selecao?.estagios).not.toContain('renovacao')
  })

  it('prévia por filtros: entram os contatos em prospecção, nunca o cliente em renovacao', async () => {
    const { client, escritas } = bancoFalso()
    const publico = aplicarRegraPublicoPorTipo({ selecao: { modo: 'filtros' } }, 'followup')

    const previa = await buscarPreviaPublicoCampanha(client, ORG, publico)

    expect([...previa.idsElegiveis].sort()).toEqual(['em-follow-up', 'primeiro-contato'])
    expect(escritas).toEqual([])
  })

  it('prévia manual: escolher à mão um cliente em renovacao não o inclui', async () => {
    const { client } = bancoFalso()
    const publico = aplicarRegraPublicoPorTipo(
      { selecao: { modo: 'manual', leadIds: ['renovacao-na-janela', 'em-follow-up'] } },
      'followup',
    )

    const previa = await buscarPreviaPublicoCampanha(client, ORG, publico)

    expect(previa.idsElegiveis).toEqual(['em-follow-up'])
  })
})

describe('campanha de renovação continua selecionando pela validade', () => {
  it('prévia: entra quem tem validade na janela, da própria organização; estágio não é critério', async () => {
    const { client, escritas } = bancoFalso([
      lead('validade-ainda-em-primeiro-contato', { estagio: 'primeiro_contato', data_validade: isoEmDias(3) }),
    ])
    const publico = aplicarRegraPublicoPorTipo({ selecao: { modo: 'filtros' } }, 'renovacao')
    expect(publico.selecao?.estagios).toBeUndefined()

    const previa = await buscarPreviaPublicoCampanha(client, ORG, publico)

    expect([...previa.idsElegiveis].sort()).toEqual(['renovacao-na-janela', 'validade-ainda-em-primeiro-contato'])
    expect(escritas).toEqual([])
  })

  it('processador (simulação): avalia o cliente em renovacao pela validade, só da própria organização, sem escrever', async () => {
    const { client, escritas } = bancoFalso()

    const r = await processarRenovacoes(ORG, { client, dryRun: true })

    expect(r.avaliados).toBe(2)
    expect(r.naJanela).toBe(1)
    expect(r.itens.map((item) => item.empresa)).toEqual(['Empresa renovacao-na-janela'])
    expect(escritas).toEqual([])
  })
})
