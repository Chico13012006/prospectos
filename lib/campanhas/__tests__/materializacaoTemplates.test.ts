// Materialização: a campanha copia o conteúdo da biblioteca para uma cópia
// PRÓPRIA, sempre na organização da campanha. Template de outra organização não
// materializa nada, e editar a biblioteca depois não mexe na campanha.
import { describe, expect, it } from 'vitest'
import { BancoFalso, type Linha } from '@/lib/templates/__tests__/bancoFalso'
import { ErroTemplateCampanha } from '../templatesCampanha'
import { materializarCampanhaGuiada } from '../materializarServidor'

const ORG_A = 'aaaaaaaa-0000-4000-8000-000000000001'
const ORG_B = 'bbbbbbbb-0000-4000-8000-000000000002'
const CAMPANHA = 'aaaaaaaa-4444-4444-8444-000000000001'
const T_A = 'aaaaaaaa-2222-4222-8222-000000000001'
const T_B = 'bbbbbbbb-2222-4222-8222-000000000001'

const template = (id: string, org: string, dados: Partial<Linha> = {}): Linha => ({
  id,
  organizacao_id: org,
  nome: 'Renovação do laudo',
  canal: 'email',
  tipo: 'renovacao_1',
  nicho: null,
  assunto: 'Validade em {{data_validade}}',
  corpo: 'Olá {{nome}}',
  html: '<p>Olá {{nome}}</p>',
  ativo: true,
  created_at: null,
  atualizado_em: null,
  ...dados,
})

function montarBanco() {
  return new BancoFalso({
    organizacoes: [{ id: ORG_A, nome: 'Org A', configuracoes: {} }, { id: ORG_B, nome: 'Org B', configuracoes: {} }],
    campanhas: [{ id: CAMPANHA, organizacao_id: ORG_A, nome: 'Campanha A', status: 'rascunho', tipo: 'renovacao', publico: {}, workflow_id: null, dry_run: true }],
    templates: [template(T_A, ORG_A), template(T_B, ORG_B, { nome: 'Segredo da B', corpo: 'Conteúdo da B' })],
    workflows: [],
    workflow_versoes: [],
  })
}

const publicoCom = (mensagem: Record<string, unknown>) => ({
  selecao: { modo: 'filtros' },
  operacao: { mensagemInicial: mensagem },
})

const mensagemHtml = {
  assunto: 'Validade em {{data_validade}}',
  corpo: 'Olá {{nome}}',
  html: '<p>Olá {{nome}}</p>',
  templateOrigemId: T_A,
}

describe('materialização com template da própria organização', () => {
  it('cria a cópia na organização da campanha, preservando assunto, texto, HTML e a origem', async () => {
    const banco = montarBanco()
    const { publico } = await materializarCampanhaGuiada(banco.cliente(), ORG_A, CAMPANHA, 'Campanha A', publicoCom(mensagemHtml))

    const inicial = publico.operacao?.mensagemInicial
    expect(inicial?.templateTipo).toBe(`campanha_${CAMPANHA.replace(/[^a-zA-Z0-9]/g, '')}_m1`.toLowerCase())
    expect(inicial?.templateOrigemId).toBe(T_A)
    expect(inicial?.html).toBe('<p>Olá {{nome}}</p>')

    const copia = banco.linhas('templates').find((t) => t.id === inicial?.templateId)
    expect(copia).toMatchObject({ organizacao_id: ORG_A, canal: 'email', tipo: inicial?.templateTipo, assunto: mensagemHtml.assunto, ativo: true })
    expect(banco.linhas('templates').filter((t) => t.organizacao_id === ORG_B)).toHaveLength(1)
  })

  it('template só de texto materializa sem HTML', async () => {
    const banco = montarBanco()
    const { publico } = await materializarCampanhaGuiada(banco.cliente(), ORG_A, CAMPANHA, 'Campanha A', publicoCom({
      assunto: 'Assunto simples',
      corpo: 'Texto simples',
      templateOrigemId: T_A,
    }))
    expect(publico.operacao?.mensagemInicial?.html).toBeUndefined()
    const copia = banco.linhas('templates').find((t) => t.id === publico.operacao?.mensagemInicial?.templateId)
    expect(copia).toMatchObject({ corpo: 'Texto simples', organizacao_id: ORG_A })
  })

  it('editar a biblioteca depois NÃO altera a campanha já materializada', async () => {
    const banco = montarBanco()
    const { publico } = await materializarCampanhaGuiada(banco.cliente(), ORG_A, CAMPANHA, 'Campanha A', publicoCom(mensagemHtml))
    const copiaId = publico.operacao?.mensagemInicial?.templateId
    const copiaAntes = { ...banco.linhas('templates').find((t) => t.id === copiaId) }

    // Alguém edita o template de origem na biblioteca.
    Object.assign(banco.linhas('templates').find((t) => t.id === T_A)!, { assunto: 'Outro assunto', corpo: 'Outro texto', html: '<p>Outro</p>' })

    const campanha = banco.linhas('campanhas').find((c) => c.id === CAMPANHA) as { publico: Record<string, unknown> }
    const inicialGravada = (campanha.publico.operacao as Record<string, unknown>).mensagemInicial as Record<string, unknown>
    expect(inicialGravada.assunto).toBe(mensagemHtml.assunto)
    expect(inicialGravada.html).toBe(mensagemHtml.html)
    expect(banco.linhas('templates').find((t) => t.id === copiaId)).toEqual(copiaAntes)
  })
})

describe('materialização com template de outra organização', () => {
  it('não materializa, não cria cópia e não grava a referência estrangeira', async () => {
    const banco = montarBanco()
    const antes = {
      templates: banco.copia('templates'),
      campanhas: banco.copia('campanhas'),
      workflows: banco.copia('workflows'),
    }
    await expect(materializarCampanhaGuiada(banco.cliente(), ORG_A, CAMPANHA, 'Campanha A', publicoCom({
      ...mensagemHtml,
      templateOrigemId: T_B,
    }))).rejects.toThrow(ErroTemplateCampanha)

    expect(banco.copia('templates')).toEqual(antes.templates)
    expect(banco.copia('campanhas')).toEqual(antes.campanhas)
    expect(banco.copia('workflows')).toEqual(antes.workflows)
    expect(banco.escritas()).toEqual([])
  })

  it('templateId (cópia) de outra organização também é recusado', async () => {
    const banco = montarBanco()
    await expect(materializarCampanhaGuiada(banco.cliente(), ORG_A, CAMPANHA, 'Campanha A', publicoCom({
      ...mensagemHtml,
      templateOrigemId: T_A,
      templateId: T_B,
    }))).rejects.toThrow(ErroTemplateCampanha)
    expect(banco.escritas()).toEqual([])
  })
})
