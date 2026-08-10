import { describe, it, expect } from 'vitest'
import {
  PERMISSOES,
  PERMISSOES_POR_ROLE,
  permissoesEfetivas,
  temPermissao,
  isPermissao,
} from '../permissoes'
import { podeAlterarRole, podeRemoverMembro } from '../guards'

describe('permissoes — efetivas e padrão por role', () => {
  it('admin recebe TODAS as permissões no padrão do role', () => {
    expect(PERMISSOES_POR_ROLE.admin).toHaveLength(PERMISSOES.length)
    const set = permissoesEfetivas('admin', [])
    for (const p of PERMISSOES) expect(set.has(p)).toBe(true)
  })

  it('usuario tem baseline de leitura e NÃO tem manage/configure', () => {
    expect(temPermissao('usuario', [], 'analytics.view')).toBe(true)
    expect(temPermissao('usuario', [], 'workflows.view')).toBe(true)
    expect(temPermissao('usuario', [], 'workspace.configure')).toBe(false)
    expect(temPermissao('usuario', [], 'campaigns.manage')).toBe(false)
  })

  it('perfil_permissoes é autoritativa quando há linhas (concede/revoga por usuário)', () => {
    // usuario com grant explícito de campaigns.manage passa a ter só o que a tabela diz
    const set = permissoesEfetivas('usuario', ['campaigns.manage'])
    expect(set.has('campaigns.manage')).toBe(true)
    // como a tabela é autoritativa, o baseline de role NÃO é somado
    expect(set.has('analytics.view')).toBe(false)
  })

  it('sem linhas na tabela → cai no padrão do role (rede de segurança do backfill)', () => {
    expect(permissoesEfetivas('admin', []).size).toBe(PERMISSOES.length)
    expect([...permissoesEfetivas('usuario', [])].sort()).toEqual(
      [...PERMISSOES_POR_ROLE.usuario].sort(),
    )
  })

  it('descarta slugs inválidos vindos da tabela', () => {
    const set = permissoesEfetivas('usuario', ['campaigns.view', 'lixo.invalido', ''])
    expect(set.has('campaigns.view')).toBe(true)
    expect(isPermissao('lixo.invalido')).toBe(false)
    expect(set.size).toBe(1)
  })

  it('role desconhecido sem grants não tem nenhuma permissão', () => {
    expect(permissoesEfetivas('fantasma', []).size).toBe(0)
  })
})

describe('guards — trava do último administrador', () => {
  it('bloqueia rebaixar o único admin (inclui auto-rebaixamento)', () => {
    const r = podeAlterarRole({ alvoRole: 'admin', novoRole: 'usuario', totalAdmins: 1 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(400)
  })

  it('permite rebaixar um admin quando há outro admin', () => {
    expect(podeAlterarRole({ alvoRole: 'admin', novoRole: 'usuario', totalAdmins: 2 }).ok).toBe(true)
  })

  it('mudanças que não rebaixam admin passam', () => {
    expect(podeAlterarRole({ alvoRole: 'usuario', novoRole: 'admin', totalAdmins: 1 }).ok).toBe(true)
    expect(podeAlterarRole({ alvoRole: 'usuario', novoRole: 'usuario', totalAdmins: 1 }).ok).toBe(true)
  })

  it('bloqueia auto-remoção', () => {
    const r = podeRemoverMembro({ alvoId: 'u1', alvoRole: 'usuario', chamadorId: 'u1', totalAdmins: 2 })
    expect(r.ok).toBe(false)
  })

  it('bloqueia remover o último admin', () => {
    const r = podeRemoverMembro({ alvoId: 'a1', alvoRole: 'admin', chamadorId: 'a2', totalAdmins: 1 })
    expect(r.ok).toBe(false)
  })

  it('permite remover um admin quando há outro', () => {
    expect(
      podeRemoverMembro({ alvoId: 'a1', alvoRole: 'admin', chamadorId: 'a2', totalAdmins: 2 }).ok,
    ).toBe(true)
  })

  it('permite remover um usuario comum', () => {
    expect(
      podeRemoverMembro({ alvoId: 'u9', alvoRole: 'usuario', chamadorId: 'a1', totalAdmins: 1 }).ok,
    ).toBe(true)
  })
})
