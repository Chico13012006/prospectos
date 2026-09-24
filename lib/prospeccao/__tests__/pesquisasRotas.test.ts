// Rotas /api/prospeccao/pesquisas com o RBAC de produção sobre o BancoFalso:
// permissão, organização e isolamento decididos pelo mesmo código do servidor.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BancoFalso } from '@/lib/templates/__tests__/bancoFalso'

const estado = vi.hoisted(() => ({ usuarioId: null as string | null, banco: null as unknown }))

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: estado.usuarioId ? { id: estado.usuarioId } : null } }) },
  }),
}))
vi.mock('@/lib/supabase-admin', () => ({
  createSupabaseAdminClient: () => (estado.banco as BancoFalso).cliente(),
}))

import { GET, POST } from '@/app/api/prospeccao/pesquisas/route'
import { DELETE, PATCH } from '@/app/api/prospeccao/pesquisas/[id]/route'

const ORG_A = 'aaaaaaaa-0000-4000-8000-000000000001'
const ORG_B = 'bbbbbbbb-0000-4000-8000-000000000002'
const ADMIN_A = 'aaaaaaaa-1111-4111-8111-00000000000a'
const COMERCIAL_A = 'aaaaaaaa-1111-4111-8111-00000000000c'
const ADMIN_B = 'bbbbbbbb-1111-4111-8111-00000000000a'
const FILTROS = { cnaes: ['5510801'], ufs: ['SP'] }
const PESQUISA_B = { id: 'pesquisa-b', nome: 'Da org B', filtros: FILTROS, quantidade: 10, criadaEm: '2026-09-01T00:00:00Z' }

function montarBanco() {
  return new BancoFalso({
    perfis: [
      { id: ADMIN_A, organizacao_id: ORG_A, role: 'admin' },
      { id: COMERCIAL_A, organizacao_id: ORG_A, role: 'usuario' },
      { id: ADMIN_B, organizacao_id: ORG_B, role: 'admin' },
    ],
    perfil_permissoes: [
      { organizacao_id: ORG_A, perfil_id: ADMIN_A, permissao: 'workspace.configure' },
      { organizacao_id: ORG_A, perfil_id: COMERCIAL_A, permissao: 'campaigns.view' },
      { organizacao_id: ORG_B, perfil_id: ADMIN_B, permissao: 'workspace.configure' },
    ],
    organizacoes: [
      { id: ORG_A, configuracoes: { _schema_version: 6, prospeccao: FILTROS } },
      { id: ORG_B, configuracoes: { _schema_version: 6, prospeccaoPesquisas: [PESQUISA_B] } },
    ],
  })
}

const banco = () => estado.banco as BancoFalso
const configDa = (org: string) => banco().linhas('organizacoes').find((o) => o.id === org)?.configuracoes as Record<string, unknown>
const json = (corpo: unknown) => ({ method: 'POST', body: JSON.stringify(corpo), headers: { 'Content-Type': 'application/json' } })
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

async function criar(corpo: unknown) {
  const res = await POST(new Request('http://localhost/api/prospeccao/pesquisas', json(corpo)))
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  estado.banco = montarBanco()
  estado.usuarioId = null
})

describe('/api/prospeccao/pesquisas', () => {
  it('sem sessão → 401', async () => {
    expect((await GET()).status).toBe(401)
    expect((await criar({ nome: 'X', filtros: FILTROS })).status).toBe(401)
  })

  it('lista só as pesquisas da própria organização e informa se pode editar', async () => {
    estado.usuarioId = COMERCIAL_A
    expect(await (await GET()).json()).toEqual({ pesquisas: [], podeEditar: false })
    estado.usuarioId = ADMIN_B
    expect(await (await GET()).json()).toEqual({ pesquisas: [PESQUISA_B], podeEditar: true })
  })

  it('sem workspace.configure não cria, não renomeia, não exclui e não grava nada', async () => {
    estado.usuarioId = COMERCIAL_A
    expect((await criar({ nome: 'X', filtros: FILTROS })).status).toBe(403)
    expect((await PATCH(new Request('http://x', { method: 'PATCH', body: '{"nome":"Y"}' }), ctx('qualquer'))).status).toBe(403)
    expect((await DELETE(new Request('http://x', { method: 'DELETE' }), ctx('qualquer'))).status).toBe(403)
    expect(banco().escritas('organizacoes')).toHaveLength(0)
  })

  it('cria na organização da sessão (ignora org no payload) sem tocar no perfil nem na outra org', async () => {
    estado.usuarioId = ADMIN_A
    const r = await criar({ nome: 'Hotéis SP', filtros: FILTROS, quantidade: 40, organizacao_id: ORG_B })
    expect(r.status).toBe(201)
    expect(r.body.pesquisas).toMatchObject([{ nome: 'Hotéis SP', filtros: FILTROS, quantidade: 40 }])
    expect(configDa(ORG_A).prospeccaoPesquisas).toHaveLength(1)
    expect(configDa(ORG_A).prospeccao).toEqual(FILTROS)
    expect(configDa(ORG_B).prospeccaoPesquisas).toEqual([PESQUISA_B])
  })

  it('validação da entrada vira 400/409 sem gravar', async () => {
    estado.usuarioId = ADMIN_A
    expect((await criar({ nome: '', filtros: FILTROS })).status).toBe(400)
    expect((await criar({ nome: 'Sem atividade', filtros: { ufs: ['SP'] } })).status).toBe(400)
    expect(banco().escritas('organizacoes')).toHaveLength(0)
  })

  it('não renomeia nem exclui pesquisa de outra organização (404) e não altera nada', async () => {
    estado.usuarioId = ADMIN_A
    const renomear = await PATCH(new Request('http://x', { method: 'PATCH', body: '{"nome":"Invadido"}' }), ctx(PESQUISA_B.id))
    expect(renomear.status).toBe(404)
    const excluir = await DELETE(new Request('http://x', { method: 'DELETE' }), ctx(PESQUISA_B.id))
    expect(excluir.status).toBe(404)
    expect(banco().escritas('organizacoes')).toHaveLength(0)
    expect(configDa(ORG_B).prospeccaoPesquisas).toEqual([PESQUISA_B])
  })

  it('renomeia e exclui a própria pesquisa', async () => {
    estado.usuarioId = ADMIN_B
    const renomear = await PATCH(new Request('http://x', { method: 'PATCH', body: '{"nome":"Novo nome"}' }), ctx(PESQUISA_B.id))
    expect(await renomear.json()).toMatchObject({ pesquisas: [{ id: PESQUISA_B.id, nome: 'Novo nome' }] })
    const excluir = await DELETE(new Request('http://x', { method: 'DELETE' }), ctx(PESQUISA_B.id))
    expect(await excluir.json()).toEqual({ pesquisas: [] })
    expect(configDa(ORG_B).prospeccaoPesquisas).toBeUndefined()
  })
})
