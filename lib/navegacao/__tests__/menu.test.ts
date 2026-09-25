import { describe, expect, it } from 'vitest'
import { agruparMenu, GRUPOS_MENU, ITENS_MENU, itemVisivel, itensVisiveis, modulosComMenu } from '../menu'
import { mesclarWorkspaceConfig, parseWorkspaceConfig } from '@/lib/config/workspaceConfig'

describe('menu lateral por organização', () => {
  it('sem configuração mostra tudo', () => {
    expect(itensVisiveis(undefined)).toHaveLength(ITENS_MENU.length)
    expect(itemVisivel({}, 'reunioes')).toBe(true)
  })

  it('esconde só o que está false', () => {
    const ids = itensVisiveis({ reunioes: false, equipe: true }).map((i) => i.id)
    expect(ids).not.toContain('reunioes')
    expect(ids).toContain('equipe')
  })

  it('grava só os ocultos e preserva chaves que não são do menu', () => {
    expect(modulosComMenu({ campanhas: true, reunioes: false, equipe: false }, ['equipe', 'inexistente']))
      .toEqual({ campanhas: true, equipe: false })
  })

  it('passa pelo ponto único de escrita e volta igual', () => {
    const cfg = mesclarWorkspaceConfig(parseWorkspaceConfig({}), { modulos: modulosComMenu({}, ['reunioes']) })
    const relido = parseWorkspaceConfig(JSON.parse(JSON.stringify(cfg)))
    expect(itensVisiveis(relido.modulos).map((i) => i.id)).not.toContain('reunioes')
  })

  it('agrupa na ordem do plano: Visão, Execução, Gestão, Administração', () => {
    const grupos = agruparMenu(ITENS_MENU)
    expect(grupos.map((g) => g.label)).toEqual(['Visão', 'Execução', 'Gestão', 'Administração'])
    expect(grupos[0].itens.map((i) => i.id)).toEqual(['dashboard', 'inteligencia_comercial'])
    expect(grupos[1].itens.map((i) => i.id)).toEqual(['prospeccao', 'automacao'])
    expect(grupos[2].itens.map((i) => i.id)).toEqual(['pipeline', 'base_leads', 'reunioes', 'comercial'])
    expect(grupos[3].itens.map((i) => i.id)).toEqual(['equipe'])
  })

  it('todo item pertence a um grupo conhecido e aparece uma vez', () => {
    const ids = GRUPOS_MENU.map((g) => g.id)
    expect(ITENS_MENU.every((i) => ids.includes(i.grupo))).toBe(true)
    expect(agruparMenu(ITENS_MENU).flatMap((g) => g.itens)).toHaveLength(ITENS_MENU.length)
  })

  it('grupo sem item visível some, salvo o que deve ficar (Configurações)', () => {
    const itens = itensVisiveis({ equipe: false, dashboard: false, inteligencia_comercial: false })
    expect(agruparMenu(itens).map((g) => g.id)).toEqual(['execucao', 'gestao'])
    expect(agruparMenu(itens, ['administracao']).map((g) => g.id)).toEqual(['execucao', 'gestao', 'administracao'])
  })
})
