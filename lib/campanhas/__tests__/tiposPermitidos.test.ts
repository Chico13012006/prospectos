import { describe, expect, it } from 'vitest'
import {
  TIPOS_CAMPANHA,
  podeUsarTipoCampanha,
  tipoCampanhaExigeAvancado,
  tiposCampanhaDisponiveis,
} from '../configuracaoGuiada'
import { PERMISSOES, PERMISSOES_POR_ROLE } from '@/lib/rbac/permissoes'

describe('objetivos de campanha por permissão', () => {
  it('só comunicado dispensa a permissão avançada', () => {
    expect(tipoCampanhaExigeAvancado('novidade_clientes')).toBe(false)
    for (const tipo of ['prospeccao', 'followup', 'reativacao', 'renovacao']) {
      expect(tipoCampanhaExigeAvancado(tipo)).toBe(true)
    }
  })

  it('sem a permissão, o wizard oferece apenas comunicado', () => {
    expect(tiposCampanhaDisponiveis(false).map((t) => t.id)).toEqual(['novidade_clientes'])
  })

  it('com a permissão, oferece todos os objetivos', () => {
    expect(tiposCampanhaDisponiveis(true)).toHaveLength(TIPOS_CAMPANHA.length)
  })

  it('recusa objetivo avançado sem a permissão e aceita com ela', () => {
    expect(podeUsarTipoCampanha('prospeccao', false)).toBe(false)
    expect(podeUsarTipoCampanha('followup', false)).toBe(false)
    expect(podeUsarTipoCampanha('novidade_clientes', false)).toBe(true)
    expect(podeUsarTipoCampanha('prospeccao', true)).toBe(true)
  })

  it('tipo ausente não é tratado como avançado (campanha legada sem tipo)', () => {
    expect(tipoCampanhaExigeAvancado(null)).toBe(false)
    expect(podeUsarTipoCampanha(null, false)).toBe(true)
    expect(podeUsarTipoCampanha(undefined, false)).toBe(true)
  })

  it('tipo desconhecido é tratado como avançado — nega por padrão', () => {
    expect(podeUsarTipoCampanha('objetivo_inventado', false)).toBe(false)
  })
})

describe('permissão no catálogo RBAC', () => {
  it('existe como slug estrutural', () => {
    expect(PERMISSOES).toContain('campaigns.tipos.avancados')
  })

  it('admin tem; usuario não', () => {
    expect(PERMISSOES_POR_ROLE.admin).toContain('campaigns.tipos.avancados')
    expect(PERMISSOES_POR_ROLE.usuario).not.toContain('campaigns.tipos.avancados')
  })

  it('usuario cria campanha, mas sem os objetivos avançados — logo, só comunicado', () => {
    expect(PERMISSOES_POR_ROLE.usuario).toContain('campaigns.manage')
    expect(PERMISSOES_POR_ROLE.usuario).not.toContain('campaigns.tipos.avancados')

    const temAvancado = PERMISSOES_POR_ROLE.usuario.includes('campaigns.tipos.avancados')
    expect(tiposCampanhaDisponiveis(temAvancado).map((t) => t.id)).toEqual(['novidade_clientes'])
  })

  it('usuario segue sem configurar o workspace nem gerenciar workflows', () => {
    expect(PERMISSOES_POR_ROLE.usuario).not.toContain('workspace.configure')
    expect(PERMISSOES_POR_ROLE.usuario).not.toContain('workflows.manage')
    expect(PERMISSOES_POR_ROLE.usuario).not.toContain('workflows.publish')
  })
})
