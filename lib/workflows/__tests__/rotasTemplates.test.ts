// Rascunho avisa, publicação bloqueia: as rotas de workflow com o RBAC e o
// store reais sobre o BancoFalso. Fecha também a corrida "desativei o template
// e publiquei mesmo assim".
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { BancoFalso, type Linha } from '@/lib/templates/__tests__/bancoFalso'

const estado = vi.hoisted(() => ({ usuarioId: null as string | null, banco: null as unknown }))

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: estado.usuarioId ? { id: estado.usuarioId } : null } }) },
  }),
}))
vi.mock('@/lib/supabase-admin', () => ({
  createSupabaseAdminClient: () => (estado.banco as BancoFalso).cliente(),
}))

import { PATCH } from '@/app/api/workflows/[id]/route'
import { POST as ACAO } from '@/app/api/workflows/[id]/acao/route'

const ORG = 'aaaaaaaa-0000-4000-8000-000000000001'
const OUTRA = 'bbbbbbbb-0000-4000-8000-000000000002'
const USUARIO = 'aaaaaaaa-1111-4111-8111-00000000000a'
const WF = 'aaaaaaaa-3333-4333-8333-000000000001'
const VERSAO = 'aaaaaaaa-3333-4333-8333-000000000009'

const template = (org: string, tipo: string, ativo = true): Linha => ({
  id: `${org}-${tipo}`,
  organizacao_id: org,
  nome: `Template ${tipo}`,
  canal: 'email',
  tipo,
  nicho: null,
  assunto: 'a',
  corpo: 'Olá {{nome}}',
  html: null,
  ativo,
})

const definicao = (tipo: string) => ({
  gatilho: { id: 'g', tipo: 'manual', config: {} },
  condicoes: [],
  acoes: [{ id: 'email-0', tipo: 'enviar_email', config: { template: tipo } }],
})

function montarBanco(workflow: Partial<Linha> = {}, versoes: Linha[] = []) {
  return new BancoFalso({
    perfis: [{ id: USUARIO, organizacao_id: ORG, role: 'admin' }],
    templates: [
      template(ORG, 'reativacao_1'),
      template(ORG, 'inativo_1', false),
      template(OUTRA, 'so_da_outra'),
    ],
    workflows: [{
      id: WF,
      organizacao_id: ORG,
      nome: 'Fluxo A',
      status: 'rascunho',
      versao_atual_id: null,
      rascunho_definicao: null,
      criado_em: '2026-09-01T00:00:00Z',
      atualizado_em: '2026-09-01T00:00:00Z',
      ...workflow,
    }],
    workflow_versoes: versoes,
  })
}

let banco: BancoFalso

beforeEach(() => {
  banco = montarBanco()
  estado.banco = banco
  estado.usuarioId = USUARIO
})

const ctx = { params: Promise.resolve({ id: WF }) }

async function salvarRascunho(tipo: string) {
  const req = new NextRequest(`http://localhost/api/workflows/${WF}`, {
    method: 'PATCH',
    body: JSON.stringify({ definicao: definicao(tipo) }),
    headers: { 'content-type': 'application/json' },
  })
  const res = await PATCH(req, { params: Promise.resolve({ id: WF }) })
  return { status: res.status, corpo: await res.json() }
}

async function acao(nome: 'publicar' | 'retomar') {
  const req = new NextRequest(`http://localhost/api/workflows/${WF}/acao`, {
    method: 'POST',
    body: JSON.stringify({ acao: nome }),
    headers: { 'content-type': 'application/json' },
  })
  const res = await ACAO(req, { params: Promise.resolve({ id: WF }) })
  return { status: res.status, corpo: await res.json() }
}

describe('rascunho: avisa, não bloqueia', () => {
  it('template válido salva sem avisos', async () => {
    const r = await salvarRascunho('reativacao_1')
    expect(r.status).toBe(200)
    expect(r.corpo.avisosTemplates).toEqual([])
    expect(banco.linhas('workflows')[0].rascunho_definicao).toBeTruthy()
  })

  it('template ausente ou desativado salva com aviso', async () => {
    const ausente = await salvarRascunho('nao_existe')
    expect(ausente.status).toBe(200)
    expect(ausente.corpo.avisosTemplates).toEqual([{ template: 'nao_existe', motivo: 'ausente' }])

    const inativo = await salvarRascunho('inativo_1')
    expect(inativo.corpo.avisosTemplates).toEqual([{ template: 'inativo_1', motivo: 'inativo' }])
    expect(banco.linhas('workflows')[0].rascunho_definicao).toBeTruthy()
  })
})

describe('publicação: bloqueia', () => {
  it('template ausente → 422 e nenhuma versão é criada', async () => {
    await salvarRascunho('nao_existe')
    const r = await acao('publicar')
    expect(r.status).toBe(422)
    expect(r.corpo.templates).toEqual([{ template: 'nao_existe', motivo: 'ausente' }])
    expect(banco.linhas('workflow_versoes')).toEqual([])
    expect(banco.linhas('workflows')[0]).toMatchObject({ status: 'rascunho', versao_atual_id: null })
  })

  it('template desativado → 422', async () => {
    await salvarRascunho('inativo_1')
    const r = await acao('publicar')
    expect(r.status).toBe(422)
    expect(r.corpo.templates).toEqual([{ template: 'inativo_1', motivo: 'inativo' }])
  })

  it('template de outra organização → 422 sem vazar a outra organização', async () => {
    await salvarRascunho('so_da_outra')
    const r = await acao('publicar')
    expect(r.status).toBe(422)
    expect(r.corpo.templates).toEqual([{ template: 'so_da_outra', motivo: 'ausente' }])
    const texto = JSON.stringify(r.corpo)
    expect(texto).not.toContain(OUTRA)
    expect(texto).not.toContain('Template so_da_outra')
  })

  it('template válido publica normalmente', async () => {
    await salvarRascunho('reativacao_1')
    const r = await acao('publicar')
    expect(r.status).toBe(200)
    expect(banco.linhas('workflow_versoes')).toHaveLength(1)
    expect(banco.linhas('workflows')[0].status).toBe('publicado')
  })

  it('desativar o template entre salvar e publicar bloqueia a publicação (corrida fechada)', async () => {
    await salvarRascunho('reativacao_1')
    const linha = banco.linhas('templates').find((t) => t.tipo === 'reativacao_1')!
    linha.ativo = false
    const r = await acao('publicar')
    expect(r.status).toBe(422)
    expect(r.corpo.templates).toEqual([{ template: 'reativacao_1', motivo: 'inativo' }])
    expect(banco.linhas('workflow_versoes')).toEqual([])
  })
})

describe('retomar: revalida a versão vigente', () => {
  it('workflow pausado com template desativado não volta a rodar', async () => {
    banco = montarBanco(
      { status: 'pausado', versao_atual_id: VERSAO },
      [{ id: VERSAO, organizacao_id: ORG, workflow_id: WF, numero: 1, definicao: definicao('inativo_1'), publicado_em: '', publicado_por: null }],
    )
    estado.banco = banco
    const r = await acao('retomar')
    expect(r.status).toBe(422)
    expect(r.corpo.erro).toContain('Não foi possível retomar')
    expect(banco.linhas('workflows')[0].status).toBe('pausado')
  })

  it('workflow pausado com template ativo volta normalmente', async () => {
    banco = montarBanco(
      { status: 'pausado', versao_atual_id: VERSAO },
      [{ id: VERSAO, organizacao_id: ORG, workflow_id: WF, numero: 1, definicao: definicao('reativacao_1'), publicado_em: '', publicado_por: null }],
    )
    estado.banco = banco
    const r = await acao('retomar')
    expect(r.status).toBe(200)
    expect(banco.linhas('workflows')[0].status).toBe('publicado')
  })
})
