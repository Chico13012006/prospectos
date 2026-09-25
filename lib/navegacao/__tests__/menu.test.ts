import { describe, expect, it } from 'vitest'
import { ITENS_MENU, itemVisivel, itensVisiveis, modulosComMenu } from '../menu'
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
})
