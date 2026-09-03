import { describe, expect, it } from 'vitest'
import { classificarPublicoCampanha, linhaAtendeCriterioCliente, type LinhaPublicoCampanha } from '../publicoServidor'

function linha(id: string, patch: Partial<LinhaPublicoCampanha> = {}): LinhaPublicoCampanha {
  return {
    id,
    empresa_id: `empresa-${id}`,
    empresa: `Empresa ${id}`,
    segmento: 'Indústria',
    estagio: 'novo',
    contato_nome: `Contato ${id}`,
    contato_email: `${id}@empresa.com`,
    responsavel_id: 'resp-1',
    owner: 'engine',
    optout: false,
    bounced: false,
    perdido: false,
    ...patch,
  }
}

describe('prévia real do público da campanha', () => {
  it('conta motivos reais e só devolve IDs elegíveis, deduplicados', () => {
    const previa = classificarPublicoCampanha([
      linha('a', { contato_email: 'MESMO@empresa.com' }),
      linha('b', { contato_email: 'mesmo@empresa.com' }),
      linha('c', { contato_email: 'inválido' }),
      linha('d', { optout: true }),
      linha('e', { owner: 'n8n' }),
      linha('f'),
      linha('g', { responsavel_id: null }),
    ], { execucoesIncompativeis: new Set(['f']) })

    expect(previa).toMatchObject({
      totalSelecionado: 7,
      emailsValidos: 6,
      emailsAusentesOuInvalidos: 1,
      duplicados: 1,
      bloqueados: 1,
      semResponsavel: 1,
      incompativeis: 1,
      elegiveis: 3,
      idsElegiveis: ['a', 'e', 'g'],
      totalEmpresas: 7,
    })
  })

  it('aplica exclusões e limite sem inventar integrantes', () => {
    const previa = classificarPublicoCampanha(
      [linha('a'), linha('b'), linha('c')],
      { excluirIds: ['a'], limite: 1 },
    )
    expect(previa.totalSelecionado).toBe(2)
    expect(previa.idsElegiveis).toEqual(['b'])
    expect(previa.truncado).toBe(true)
  })

  it('agrupa os contatos pelas empresas reais e informa quantos são elegíveis', () => {
    const previa = classificarPublicoCampanha([
      linha('a', { empresa_id: 'empresa-acme', empresa: 'Acme' }),
      linha('b', { empresa_id: 'empresa-acme', empresa: 'Acme', optout: true }),
      linha('c', { empresa: 'Beta' }),
      linha('d', { empresa_id: null, empresa: null, segmento: null }),
    ])

    expect(previa.totalEmpresas).toBe(3)
    expect(previa.totalEmpresasSelecionadas).toBe(3)
    expect(previa.empresas).toEqual([
      { chave: 'id:empresa-acme', nome: 'Acme', segmento: 'Indústria', contatos: 2, elegiveis: 1, selecionada: true },
      { chave: 'id:empresa-c', nome: 'Beta', segmento: 'Indústria', contatos: 1, elegiveis: 1, selecionada: true },
      { chave: 'nome:__nao_configurado__', nome: 'Não configurado', segmento: null, contatos: 1, elegiveis: 1, selecionada: true },
    ])
  })

  it('mantém a empresa excluída auditável na lista e remove todos os seus contatos', () => {
    const previa = classificarPublicoCampanha([
      linha('a', { empresa_id: 'empresa-acme', empresa: 'Acme' }),
      linha('b', { empresa_id: 'empresa-acme', empresa: 'Acme' }),
      linha('c', { empresa_id: 'empresa-beta', empresa: 'Beta', segmento: null }),
    ], { excluirEmpresas: ['id:empresa-acme'] })

    expect(previa.totalSelecionado).toBe(1)
    expect(previa.idsElegiveis).toEqual(['c'])
    expect(previa.totalEmpresas).toBe(2)
    expect(previa.totalEmpresasSelecionadas).toBe(1)
    expect(previa.empresas).toEqual([
      { chave: 'id:empresa-acme', nome: 'Acme', segmento: 'Indústria', contatos: 2, elegiveis: 0, selecionada: false },
      { chave: 'id:empresa-beta', nome: 'Beta', segmento: null, contatos: 1, elegiveis: 1, selecionada: true },
    ])
  })

  it('renovação escolhe somente um contato por cliente', () => {
    const previa = classificarPublicoCampanha([
      linha('a', { empresa_id: 'empresa-acme', empresa: 'Acme', contato_email: 'a@acme.com' }),
      linha('b', { empresa_id: 'empresa-acme', empresa: 'Acme', contato_email: 'b@acme.com' }),
      linha('c', { empresa_id: 'empresa-beta', empresa: 'Beta', contato_email: 'c@beta.com' }),
    ], { umContatoPorEmpresa: true })

    expect(previa.idsElegiveis).toEqual(['a', 'c'])
    expect(previa.duplicados).toBe(1)
    expect(previa.empresas.find((empresa) => empresa.nome === 'Acme')?.elegiveis).toBe(1)
  })

  it('distingue clientes reais de contatos ainda em prospecção', () => {
    const marcadores = {
      empresasComServico: new Set(['empresa-servico']),
      empresasComRenovacao: new Set(['empresa-renovacao']),
      empresasComValidadeLegada: new Set(['empresa-legada']),
      leadsComValidadeLegada: new Set(['lead-legado']),
      empresasComOportunidadeGanha: new Set(['empresa-oportunidade']),
      leadsComOportunidadeGanha: new Set(['lead-oportunidade']),
    }
    expect(linhaAtendeCriterioCliente(linha('servico', { empresa_id: 'empresa-servico', estagio: 'novos_leads' }), 'clientes', marcadores)).toBe(true)
    expect(linhaAtendeCriterioCliente(linha('ganho', { estagio: 'ganho' }), 'clientes', marcadores)).toBe(true)
    expect(linhaAtendeCriterioCliente(linha('lead-oportunidade'), 'clientes', marcadores)).toBe(true)
    expect(linhaAtendeCriterioCliente(linha('prospectando', { estagio: 'follow_up' }), 'clientes', marcadores)).toBe(false)
    expect(linhaAtendeCriterioCliente(linha('ganho', { estagio: 'ganho' }), 'renovacao', marcadores)).toBe(false)
    expect(linhaAtendeCriterioCliente(linha('renovacao', { empresa_id: 'empresa-renovacao' }), 'renovacao', marcadores)).toBe(true)
    expect(linhaAtendeCriterioCliente(linha('legada', { empresa_id: 'empresa-legada' }), 'renovacao', marcadores)).toBe(true)
    expect(linhaAtendeCriterioCliente(linha('lead-legado', { empresa_id: null }), 'renovacao', marcadores)).toBe(true)
    expect(linhaAtendeCriterioCliente(linha('servico', { empresa_id: 'empresa-servico' }), 'renovacao', marcadores)).toBe(false)
  })
})
