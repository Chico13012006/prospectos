import { describe, expect, it } from 'vitest'
import { parseWorkspaceConfig, serializeWorkspaceConfig } from '../../config/workspaceConfig'
import {
  ESTAGIO_INICIAL_PADRAO,
  ESTAGIO_RENOVACAO,
  estagioInicialLead,
  regraRenovacaoPorValidadeAtiva,
} from '../estagioInicial'
import { dedupeInternaPorEmail, processarPlanilhaPadrao } from '../importarCsv'
import { camposBaseImportacao, montarLeadsImportacao } from '../importacaoOperacional'
import { normalizarPatchCadastralLead } from '../edicao'

const ORG_COM_REGRA = parseWorkspaceConfig({ features: { empresaContatoReads: true, estagioRenovacaoPorValidade: true } })
const OUTRA_ORG = parseWorkspaceConfig({ features: { empresaContatoReads: true } })

describe('estágio inicial por validade', () => {
  it('organização com a regra + validade → renovacao', () => {
    const regra = regraRenovacaoPorValidadeAtiva(ORG_COM_REGRA)
    expect(regra).toBe(true)
    expect(estagioInicialLead('2026-10-15', regra)).toBe(ESTAGIO_RENOVACAO)
  })

  it('organização com a regra + sem validade → novos_leads', () => {
    for (const semValidade of [null, undefined, '', '   ']) {
      expect(estagioInicialLead(semValidade, true)).toBe(ESTAGIO_INICIAL_PADRAO)
    }
    expect(ESTAGIO_INICIAL_PADRAO).toBe('novos_leads')
  })

  it('outra organização (sem a regra) + validade → comportamento normal', () => {
    for (const cfg of [OUTRA_ORG, parseWorkspaceConfig({}), parseWorkspaceConfig(null), parseWorkspaceConfig({ features: { estagioRenovacaoPorValidade: false } })]) {
      const regra = regraRenovacaoPorValidadeAtiva(cfg)
      expect(regra).toBe(false)
      expect(estagioInicialLead('2026-10-15', regra)).toBe('novos_leads')
    }
  })

  it('a flag é tipada no blob: valor não booleano é descartado e a serialização preserva as demais', () => {
    expect(parseWorkspaceConfig({ features: { estagioRenovacaoPorValidade: 'true' } }).features).toBeUndefined()
    expect(serializeWorkspaceConfig({ ...OUTRA_ORG, features: { ...OUTRA_ORG.features, estagioRenovacaoPorValidade: true } }).features)
      .toEqual({ empresaContatoReads: true, estagioRenovacaoPorValidade: true })
  })
})

describe('importação CSV respeita a regra da organização', () => {
  const csv = [
    'Nome;E-mail;Empresa;Nicho;Validade',
    'Ana;ana@parque-a.com.br;Parque A;Buffet infantil;15/10/2026',
    'Bruno;bruno@parque-b.com.br;Parque B;Buffet infantil;',
    'Carla;carla@parque-c.com.br;Parque C;Buffet infantil;2027-01-31',
    'Davi;davi@parque-d.com.br;Parque D;Buffet infantil;31/02/2026',
  ].join('\n')
  const responsavel = { id: 'usuario-1', nome: 'Comercial' }

  function linhasDoCsv(estagioRenovacaoPorValidade: boolean) {
    const { validos } = processarPlanilhaPadrao(csv)
    const { unicos } = dedupeInternaPorEmail(validos)
    return montarLeadsImportacao(unicos, { organizacaoId: 'org-1', responsavel, estagioRenovacaoPorValidade })
  }

  it('CSV misto com a regra: validade → renovacao; sem validade (ou inválida) → novos_leads', () => {
    const linhas = linhasDoCsv(regraRenovacaoPorValidadeAtiva(ORG_COM_REGRA))
    expect(linhas.map((l) => [l.contato_email, l.estagio, l.data_validade])).toEqual([
      ['ana@parque-a.com.br', 'renovacao', '2026-10-15'],
      ['bruno@parque-b.com.br', 'novos_leads', null],
      ['carla@parque-c.com.br', 'renovacao', '2027-01-31'],
      ['davi@parque-d.com.br', 'novos_leads', null],
    ])
    for (const linha of linhas) {
      expect(linha).toMatchObject({
        organizacao_id: 'org-1',
        owner: 'n8n',
        followups_enviados: 0,
        responsavel_id: 'usuario-1',
        responsavel_nome: 'Comercial',
      })
    }
  })

  it('o mesmo CSV sem a regra entra todo em novos_leads, preservando a validade', () => {
    const linhas = linhasDoCsv(regraRenovacaoPorValidadeAtiva(OUTRA_ORG))
    expect(linhas.map((l) => l.estagio)).toEqual(['novos_leads', 'novos_leads', 'novos_leads', 'novos_leads'])
    expect(linhas.map((l) => l.data_validade)).toEqual(['2026-10-15', null, '2027-01-31', null])
    expect(camposBaseImportacao('org-1').estagio).toBe('novos_leads')
  })
})

describe('edição posterior da validade', () => {
  it('preencher data_validade na edição não altera o estágio', () => {
    const patch = normalizarPatchCadastralLead({ data_validade: '2027-03-14' })
    expect(patch).toEqual({ data_validade: '2027-03-14' })
    expect(patch).not.toHaveProperty('estagio')
  })
})
