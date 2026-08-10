import { describe, it, expect } from 'vitest'
import {
  WORKSPACE_CONFIG_SCHEMA_VERSION,
  configPadrao,
  parseWorkspaceConfig,
  serializeWorkspaceConfig,
  renovacaoEfetiva,
  RENOVACAO_PADRAO,
} from '../workspaceConfig'

describe('workspaceConfig', () => {
  it('blob vazio (default da migration) vira padrões com a versão atual', () => {
    expect(parseWorkspaceConfig({})).toEqual({ _schema_version: WORKSPACE_CONFIG_SCHEMA_VERSION })
    expect(configPadrao()._schema_version).toBe(WORKSPACE_CONFIG_SCHEMA_VERSION)
  })

  it('entrada não-objeto cai nos padrões, sem lançar', () => {
    expect(parseWorkspaceConfig(null)).toEqual(configPadrao())
    expect(parseWorkspaceConfig('x')).toEqual(configPadrao())
    expect(parseWorkspaceConfig([1, 2])).toEqual(configPadrao())
  })

  it('carimba a versão em blob sem _schema_version (tratado como v0)', () => {
    const r = parseWorkspaceConfig({ dashboardWidgets: ['leads'] })
    expect(r._schema_version).toBe(WORKSPACE_CONFIG_SCHEMA_VERSION)
    expect(r.dashboardWidgets).toEqual(['leads'])
  })

  it('força os tipos das chaves conhecidas (descarta valor com tipo errado)', () => {
    const r = parseWorkspaceConfig({
      dashboardWidgets: ['ok', 3, null, 'bom'],
      nomenclaturas: { cliente: 'Parceiro', ruim: 5 },
      modulos: { reunioes: false, invalido: 'x' },
    })
    expect(r.dashboardWidgets).toEqual(['ok', 'bom'])
    expect(r.nomenclaturas).toEqual({ cliente: 'Parceiro' })
    expect(r.modulos).toEqual({ reunioes: false })
  })

  it('serialize é o ponto único de escrita e sempre carimba a versão', () => {
    const r = serializeWorkspaceConfig({ modulos: { campanhas: true } })
    expect(r._schema_version).toBe(WORKSPACE_CONFIG_SCHEMA_VERSION)
    expect(r.modulos).toEqual({ campanhas: true })
  })

  it('ignora _schema_version forjado no payload de escrita', () => {
    const r = serializeWorkspaceConfig({ _schema_version: 999 } as never)
    expect(r._schema_version).toBe(WORKSPACE_CONFIG_SCHEMA_VERSION)
  })

  it('renovacao: parse valida tipos e renovacaoEfetiva aplica defaults', () => {
    const semConfig = renovacaoEfetiva(parseWorkspaceConfig({}))
    expect(semConfig).toEqual(RENOVACAO_PADRAO)

    const parsed = parseWorkspaceConfig({ renovacao: { antecedenciaDias: 30, enviarPrimeiraMensagem: false, templateTipo: 5 } })
    expect(parsed.renovacao).toEqual({ antecedenciaDias: 30, enviarPrimeiraMensagem: false }) // templateTipo inválido descartado
    const efetiva = renovacaoEfetiva(parsed)
    expect(efetiva.antecedenciaDias).toBe(30)
    expect(efetiva.enviarPrimeiraMensagem).toBe(false)
    expect(efetiva.templateTipo).toBe(RENOVACAO_PADRAO.templateTipo) // cai no default
  })
})
