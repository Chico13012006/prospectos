// Regras de tela da biblioteca: o que cada permissão vê, como os filtros viram
// query e como o 409 de "template em uso" é explicado.
import { describe, expect, it } from 'vitest'
import {
  CANAIS_FILTRO,
  CANAIS_NOVO_TEMPLATE,
  acessoBiblioteca,
  acoesDoTemplate,
  formatarAtualizadoEm,
  mensagemUsos,
  queryFiltros,
  rotuloCanal,
  rotuloFormato,
  rotuloStatus,
} from '../biblioteca'
import type { TemplateBiblioteca, UsoTemplate } from '../tipos'

const template = (parcial: Partial<TemplateBiblioteca> = {}): TemplateBiblioteca => ({
  id: 'id',
  nome: 'Renovação',
  canal: 'email',
  formato: 'texto',
  tipo: 'renovacao_1',
  nicho: null,
  assunto: 'Validade',
  corpo: 'Olá',
  html: null,
  ativo: true,
  somenteLeitura: false,
  criadoEm: null,
  atualizadoEm: null,
  ...parcial,
})

describe('acesso e ações', () => {
  it('templates.view abre a biblioteca; templates.manage libera as ações', () => {
    expect(acessoBiblioteca([])).toEqual({ podeVer: false, podeGerenciar: false })
    expect(acessoBiblioteca(['templates.view'])).toEqual({ podeVer: true, podeGerenciar: false })
    expect(acessoBiblioteca(['templates.view', 'templates.manage'])).toEqual({ podeVer: true, podeGerenciar: true })
  })

  it('sem manage a tela é só leitura', () => {
    expect(acoesDoTemplate(template(), false)).toEqual(['visualizar'])
    expect(acoesDoTemplate(template({ ativo: false }), false)).toEqual(['visualizar'])
  })

  it('com manage, ativo oferece desativar e inativo oferece reativar', () => {
    expect(acoesDoTemplate(template(), true)).toEqual(['visualizar', 'editar', 'desativar'])
    expect(acoesDoTemplate(template({ ativo: false }), true)).toEqual(['visualizar', 'editar', 'reativar'])
  })
})

describe('filtros', () => {
  it('monta a query só com o que foi escolhido', () => {
    expect(queryFiltros({})).toBe('')
    expect(queryFiltros({ ativo: 'ativos' })).toBe('')
    expect(queryFiltros({ canal: 'whatsapp' })).toBe('?canal=whatsapp')
    expect(queryFiltros({ formato: 'html' })).toBe('?formato=html')
    expect(queryFiltros({ busca: '  renova  ' })).toBe('?busca=renova')
    expect(queryFiltros({ ativo: 'inativos' })).toBe('?ativo=false')
    expect(queryFiltros({ ativo: 'todos' })).toBe('?ativo=todos')
    expect(queryFiltros({ canal: 'email', formato: 'texto', busca: 'fup', ativo: 'todos' }))
      .toBe('?canal=email&formato=texto&busca=fup&ativo=todos')
  })

  it('filtra os quatro canais, mas só oferece e-mail e WhatsApp em template novo', () => {
    expect(CANAIS_FILTRO.map((c) => c.valor)).toEqual(['email', 'whatsapp', 'linkedin', 'telefone'])
    expect(CANAIS_NOVO_TEMPLATE.map((c) => c.valor)).toEqual(['email', 'whatsapp'])
    expect(rotuloCanal('linkedin')).toBe('LinkedIn')
    expect(rotuloCanal('telefone')).toBe('Telefone')
  })

  it('rótulos e data', () => {
    expect(rotuloFormato('html')).toBe('HTML')
    expect(rotuloFormato('texto')).toBe('Texto')
    expect(rotuloStatus(true)).toBe('Ativo')
    expect(rotuloStatus(false)).toBe('Inativo')
    expect(formatarAtualizadoEm('2026-09-15T12:00:00Z')).toBe('15/09/2026')
    expect(formatarAtualizadoEm(null)).toBe('—')
    expect(formatarAtualizadoEm('nao-e-data')).toBe('—')
  })
})

describe('mensagem de template em uso (409)', () => {
  it('explica cada uso e o caminho de saída', () => {
    const usos: UsoTemplate[] = [
      { tipo: 'workflow', id: 'w1', nome: 'Reativação de clientes', status: 'publicado', versao: 7 },
      { tipo: 'execucoes', quantidade: 2 },
      { tipo: 'campanha', id: 'c1', nome: 'Campanha ativa', status: 'ativa' },
      { tipo: 'motor_cadencia', quantidade: 1 },
    ]
    const mensagem = mensagemUsos(usos)
    expect(mensagem).toContain('workflow "Reativação de clientes" (publicado, versão 7)')
    expect(mensagem).toContain('2 execuções em andamento')
    expect(mensagem).toContain('campanha "Campanha ativa" (ativa)')
    expect(mensagem).toContain('1 lead na cadência automática')
    expect(mensagem).toContain('variante ativa com a mesma chave')
    expect(mensagem).not.toContain('w1')
    expect(mensagem).not.toContain('c1')
  })

  it('singular e plural das contagens', () => {
    expect(mensagemUsos([{ tipo: 'execucoes', quantidade: 1 }])).toContain('1 execução em andamento')
    expect(mensagemUsos([{ tipo: 'motor_cadencia', quantidade: 3 }])).toContain('3 leads na cadência automática')
  })

  it('sem detalhes ainda diz que está em uso', () => {
    expect(mensagemUsos([])).toBe('Este template está em uso e não pode ser desativado agora.')
  })
})
