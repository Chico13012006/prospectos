import { describe, it, expect } from 'vitest'
import { planejarDedup, normalizarNomeEmpresa, dominioEmpresa, type LeadEntrada } from '../dedup'

const porId = (plano: ReturnType<typeof planejarDedup>) =>
  Object.fromEntries(plano.map((p) => [p.leadId, p]))

describe('normalização auxiliar', () => {
  it('normaliza nome (acentos, caixa, pontuação)', () => {
    expect(normalizarNomeEmpresa('Óticas Visão & Cia. LTDA')).toBe('oticas visao cia ltda')
  })
  it('domínio de empresa ignora provedores pessoais', () => {
    expect(dominioEmpresa('joao@empresa.com.br')).toBe('empresa.com.br')
    expect(dominioEmpresa('joao@gmail.com')).toBeNull()
    expect(dominioEmpresa('semarroba')).toBeNull()
  })
})

describe('planejarDedup — política conservadora', () => {
  it('merge por CNPJ igual (autoritativo, sem revisão)', () => {
    const leads: LeadEntrada[] = [
      { id: 'a', empresa: 'Empresa X', contato_email: 'a@x.com', cnpj: '11.222.333/0001-81' },
      { id: 'b', empresa: 'Nome Diferente', contato_email: 'b@outro.com', cnpj: '11222333000181' },
    ]
    const p = porId(planejarDedup(leads))
    expect(p.a.empresaChave).toBe(p.b.empresaChave)
    expect(p.a.metodo).toBe('cnpj')
    expect(p.a.revisaoPendente).toBe(false)
  })

  it('merge por nome + domínio iguais', () => {
    const leads: LeadEntrada[] = [
      { id: 'a', empresa: 'Hotel Central', contato_email: 'joao@central.com' },
      { id: 'b', empresa: 'HOTEL  CENTRAL', contato_email: 'maria@central.com' },
    ]
    const p = porId(planejarDedup(leads))
    expect(p.a.empresaChave).toBe(p.b.empresaChave)
    expect(p.a.metodo).toBe('nome_dominio')
    expect(p.a.revisaoPendente).toBe(false)
  })

  it('NÃO faz merge por domínio isolado — nomes distintos no mesmo domínio ficam separados e marcados', () => {
    const leads: LeadEntrada[] = [
      { id: 'a', empresa: 'Filial Norte', contato_email: 'a@grupo.com' },
      { id: 'b', empresa: 'Filial Sul', contato_email: 'b@grupo.com' },
    ]
    const p = porId(planejarDedup(leads))
    expect(p.a.empresaChave).not.toBe(p.b.empresaChave)
    expect(p.a.revisaoPendente).toBe(true)
    expect(p.b.revisaoPendente).toBe(true)
    expect(p.a.motivoRevisao).toMatch(/filial|domínio/i)
  })

  it('NÃO faz merge por nome isolado — mesmo nome sem domínio (e-mail pessoal) fica separado e marcado', () => {
    const leads: LeadEntrada[] = [
      { id: 'a', empresa: 'Ótica Boa Vista', contato_email: 'a@gmail.com' },
      { id: 'b', empresa: 'Ótica Boa Vista', contato_email: 'b@hotmail.com' },
    ]
    const p = porId(planejarDedup(leads))
    expect(p.a.empresaChave).not.toBe(p.b.empresaChave)
    expect(p.a.metodo).toBe('isolado')
    expect(p.a.revisaoPendente).toBe(true)
    expect(p.a.motivoRevisao).toMatch(/nome repetido/i)
  })

  it('nome único com e-mail pessoal → empresa própria, sem revisão', () => {
    const leads: LeadEntrada[] = [
      { id: 'a', empresa: 'Padaria do Zé', contato_email: 'ze@gmail.com' },
    ]
    const p = porId(planejarDedup(leads))
    expect(p.a.metodo).toBe('isolado')
    expect(p.a.revisaoPendente).toBe(false)
  })

  it('mesmo nome em domínios diferentes → empresas distintas (não são a mesma)', () => {
    const leads: LeadEntrada[] = [
      { id: 'a', empresa: 'Central', contato_email: 'a@central-rj.com' },
      { id: 'b', empresa: 'Central', contato_email: 'b@central-sp.com' },
    ]
    const p = porId(planejarDedup(leads))
    expect(p.a.empresaChave).not.toBe(p.b.empresaChave)
    // ambos nome_dominio, domínios únicos → sem flag de domínio compartilhado
    expect(p.a.revisaoPendente).toBe(false)
  })
})
