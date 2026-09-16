// Nenhuma campanha pode referenciar (nem gravar) template de outra organização.
import { describe, expect, it } from 'vitest'
import { BancoFalso, type Linha } from '@/lib/templates/__tests__/bancoFalso'
import { ErroTemplateCampanha, exigirTemplatesDaOrganizacao } from '../templatesCampanha'

const ORG_A = 'aaaaaaaa-0000-4000-8000-000000000001'
const ORG_B = 'bbbbbbbb-0000-4000-8000-000000000002'
const T_A = 'aaaaaaaa-2222-4222-8222-000000000001'
const COPIA_A = 'aaaaaaaa-2222-4222-8222-000000000002'
const WHATS_A = 'aaaaaaaa-2222-4222-8222-000000000003'
const T_B = 'bbbbbbbb-2222-4222-8222-000000000001'

const template = (id: string, org: string, dados: Partial<Linha> = {}): Linha => ({
  id,
  organizacao_id: org,
  nome: 'Template',
  canal: 'email',
  tipo: 'renovacao_1',
  nicho: null,
  assunto: 'a',
  corpo: 'b',
  html: null,
  ativo: true,
  created_at: null,
  atualizado_em: null,
  ...dados,
})

function banco() {
  return new BancoFalso({
    templates: [
      template(T_A, ORG_A),
      template(COPIA_A, ORG_A, { tipo: 'campanha_abc_m1' }),
      template(WHATS_A, ORG_A, { canal: 'whatsapp', tipo: 'primeiro_contato', assunto: null }),
      template(T_B, ORG_B, { nome: 'Segredo da B' }),
    ],
  })
}

const publicoCom = (mensagem: Record<string, unknown>) => ({ operacao: { mensagemInicial: mensagem } })

describe('templates referenciados por uma campanha', () => {
  it('aceita template e cópia da própria organização', async () => {
    const b = banco()
    await expect(exigirTemplatesDaOrganizacao(b.cliente(), ORG_A, publicoCom({ templateOrigemId: T_A, templateId: COPIA_A })))
      .resolves.toBeUndefined()
  })

  it('aceita público sem nenhum vínculo de template', async () => {
    const b = banco()
    await expect(exigirTemplatesDaOrganizacao(b.cliente(), ORG_A, { operacao: { mensagemInicial: { assunto: 'a', corpo: 'b' } } }))
      .resolves.toBeUndefined()
    expect(b.operacoes).toEqual([])
  })

  it('recusa templateId de outra organização como inexistente', async () => {
    const b = banco()
    await expect(exigirTemplatesDaOrganizacao(b.cliente(), ORG_A, publicoCom({ templateId: T_B })))
      .rejects.toThrow(ErroTemplateCampanha)
    expect(b.escritas()).toEqual([])
  })

  it('recusa templateOrigemId de outra organização', async () => {
    const b = banco()
    const erro = await exigirTemplatesDaOrganizacao(b.cliente(), ORG_A, publicoCom({ templateOrigemId: T_B, assunto: 'x' }))
      .catch((e) => e)
    expect(erro).toBeInstanceOf(ErroTemplateCampanha)
    expect(erro.status).toBe(404)
    expect(erro.message).toBe('Template não encontrado.')
  })

  it('recusa vínculo em follow-up, não só na mensagem inicial', async () => {
    const b = banco()
    await expect(exigirTemplatesDaOrganizacao(b.cliente(), ORG_A, {
      operacao: { mensagemInicial: { templateId: COPIA_A }, followups: [{ templateOrigemId: T_B }] },
    })).rejects.toThrow(ErroTemplateCampanha)
  })

  it('recusa id inexistente e id que não é UUID', async () => {
    const b = banco()
    for (const id of ['cccccccc-2222-4222-8222-000000000009', 'nao-e-uuid']) {
      await expect(exigirTemplatesDaOrganizacao(b.cliente(), ORG_A, publicoCom({ templateId: id })))
        .rejects.toThrow(ErroTemplateCampanha)
    }
  })

  it('origem precisa ser template de e-mail', async () => {
    const b = banco()
    await expect(exigirTemplatesDaOrganizacao(b.cliente(), ORG_A, publicoCom({ templateOrigemId: WHATS_A })))
      .rejects.toThrow(ErroTemplateCampanha)
  })

  it('toda consulta é escopada à organização da campanha', async () => {
    const b = banco()
    await exigirTemplatesDaOrganizacao(b.cliente(), ORG_A, publicoCom({ templateOrigemId: T_A, templateId: COPIA_A }))
    for (const op of b.operacoes) {
      expect(op.filtros).toContainEqual({ op: 'eq', coluna: 'organizacao_id', valor: ORG_A })
    }
  })
})
