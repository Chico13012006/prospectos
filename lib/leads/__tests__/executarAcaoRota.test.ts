// POST /api/leads/[id]/executar-acao — a porta do usuário para o motor. Sessão,
// permissão, escopo do lead e organização são decididos pelo código de produção
// (exigirPermissao + podeAcessarLead) sobre o BancoFalso; só o motor é
// substituído, para provar QUANDO ele é chamado e com qual organização.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { BancoFalso } from '@/lib/templates/__tests__/bancoFalso'

const estado = vi.hoisted(() => ({
  usuarioId: null as string | null,
  banco: null as unknown,
  authUsers: [] as { id: string; email: string }[],
}))
const motor = vi.hoisted(() => ({
  criarMotor: vi.fn(),
  executarAcao: vi.fn(),
}))

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: estado.usuarioId ? { id: estado.usuarioId } : null } }) },
  }),
}))
vi.mock('@/lib/supabase-admin', () => ({
  createSupabaseAdminClient: () => ({
    ...(estado.banco as BancoFalso).cliente(),
    auth: { admin: { listUsers: async () => ({ data: { users: estado.authUsers }, error: null }) } },
  }),
}))
vi.mock('@/lib/engine', () => ({
  criarMotor: motor.criarMotor,
  executarAcao: motor.executarAcao,
}))

import { POST } from '@/app/api/leads/[id]/executar-acao/route'

const ORG_A = 'aaaaaaaa-0000-4000-8000-000000000001'
const ORG_B = 'bbbbbbbb-0000-4000-8000-000000000002'
const ADMIN_A = 'aaaaaaaa-1111-4111-8111-00000000000a'
const COMERCIAL_A = 'aaaaaaaa-1111-4111-8111-00000000000c'
const SEM_ENVIO_A = 'aaaaaaaa-1111-4111-8111-00000000000d'
const USUARIO_COMERCIAL_A = 'aaaaaaaa-5555-4555-8555-00000000000c'
const USUARIO_OUTRO_A = 'aaaaaaaa-5555-4555-8555-00000000000e'
const LEAD_A_DO_COMERCIAL = 'aaaaaaaa-6666-4666-8666-000000000001'
const LEAD_A_DE_OUTRO = 'aaaaaaaa-6666-4666-8666-000000000002'
const LEAD_B = 'bbbbbbbb-6666-4666-8666-000000000001'

function montarBanco() {
  return new BancoFalso({
    perfis: [
      { id: ADMIN_A, organizacao_id: ORG_A, role: 'admin', nome: 'Admin A' },
      { id: COMERCIAL_A, organizacao_id: ORG_A, role: 'usuario', nome: 'Comercial A' },
      { id: SEM_ENVIO_A, organizacao_id: ORG_A, role: 'usuario', nome: 'Sem envio' },
    ],
    perfil_permissoes: [
      { organizacao_id: ORG_A, perfil_id: ADMIN_A, permissao: 'conversations.send' },
      { organizacao_id: ORG_A, perfil_id: COMERCIAL_A, permissao: 'conversations.send' },
      { organizacao_id: ORG_A, perfil_id: SEM_ENVIO_A, permissao: 'campaigns.view' },
    ],
    usuarios: [
      { id: USUARIO_COMERCIAL_A, organizacao_id: ORG_A, nome: 'Comercial A', email: 'comercial@a.test', ativo: true },
      { id: USUARIO_OUTRO_A, organizacao_id: ORG_A, nome: 'Outro A', email: 'outro@a.test', ativo: true },
    ],
    leads: [
      { id: LEAD_A_DO_COMERCIAL, organizacao_id: ORG_A, responsavel_id: USUARIO_COMERCIAL_A, responsavel_nome: null },
      { id: LEAD_A_DE_OUTRO, organizacao_id: ORG_A, responsavel_id: USUARIO_OUTRO_A, responsavel_nome: null },
      { id: LEAD_B, organizacao_id: ORG_B, responsavel_id: null, responsavel_nome: null },
    ],
  })
}

async function chamar(leadId: string) {
  const res = await POST(
    new NextRequest(`http://localhost/api/leads/${leadId}/executar-acao`, { method: 'POST' }),
    { params: Promise.resolve({ id: leadId }) },
  )
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  estado.banco = montarBanco()
  estado.usuarioId = null
  estado.authUsers = [
    { id: ADMIN_A, email: 'admin@a.test' },
    { id: COMERCIAL_A, email: 'comercial@a.test' },
    { id: SEM_ENVIO_A, email: 'semenvio@a.test' },
  ]
  motor.criarMotor.mockReset().mockImplementation((org: string) => ({
    store: { organizacaoId: org },
    emailProspeccao: { conta: 'prospeccao' },
  }))
  motor.executarAcao.mockReset().mockResolvedValue({ ok: true, estagio: 'contato_1' })
})

describe('POST /api/leads/[id]/executar-acao', () => {
  it('sem sessão → 401 e o motor não é acionado', async () => {
    const r = await chamar(LEAD_A_DO_COMERCIAL)
    expect(r.status).toBe(401)
    expect(motor.executarAcao).not.toHaveBeenCalled()
  })

  it('sem conversations.send → 403 e o motor não é acionado', async () => {
    estado.usuarioId = SEM_ENVIO_A
    const r = await chamar(LEAD_A_DO_COMERCIAL)
    expect(r.status).toBe(403)
    expect(motor.executarAcao).not.toHaveBeenCalled()
  })

  it('lead de outra organização → 404, mesmo para admin, e o motor não é acionado', async () => {
    estado.usuarioId = ADMIN_A
    const r = await chamar(LEAD_B)
    expect(r.status).toBe(404)
    expect(motor.criarMotor).not.toHaveBeenCalled()
    expect(motor.executarAcao).not.toHaveBeenCalled()
  })

  it('comercial sem acesso ao lead (responsável é outro) → 404', async () => {
    estado.usuarioId = COMERCIAL_A
    const r = await chamar(LEAD_A_DE_OUTRO)
    expect(r.status).toBe(404)
    expect(motor.executarAcao).not.toHaveBeenCalled()
  })

  it('comercial responsável pelo lead → executa no motor da própria organização', async () => {
    estado.usuarioId = COMERCIAL_A
    const r = await chamar(LEAD_A_DO_COMERCIAL)
    expect(r).toEqual({ status: 200, body: { ok: true, estagio: 'contato_1' } })
    expect(motor.criarMotor).toHaveBeenCalledWith(ORG_A)
    expect(motor.executarAcao).toHaveBeenCalledWith(
      { organizacaoId: ORG_A },
      { conta: 'prospeccao' },
      { leadId: LEAD_A_DO_COMERCIAL },
    )
  })

  it('admin executa qualquer lead da própria organização', async () => {
    estado.usuarioId = ADMIN_A
    const r = await chamar(LEAD_A_DE_OUTRO)
    expect(r.status).toBe(200)
    expect(motor.criarMotor).toHaveBeenCalledWith(ORG_A)
  })

  it('recusa do motor (trava de idempotência) → 409 com o motivo', async () => {
    estado.usuarioId = ADMIN_A
    motor.executarAcao.mockResolvedValue({ ok: false, motivo: 'ja_enviado' })
    const r = await chamar(LEAD_A_DO_COMERCIAL)
    expect(r).toEqual({ status: 409, body: { ok: false, motivo: 'ja_enviado' } })
  })

  it('falha do motor → 500 sem vazar detalhe', async () => {
    estado.usuarioId = ADMIN_A
    motor.executarAcao.mockRejectedValue(new Error('detalhe interno'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await chamar(LEAD_A_DO_COMERCIAL)
    expect(r).toEqual({ status: 500, body: { erro: 'Erro interno do motor' } })
  })
})
