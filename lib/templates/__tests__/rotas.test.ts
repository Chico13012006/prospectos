// Rotas /api/templates e /api/templates/[id] com o RBAC de produção
// (exigirPermissao → perfis + perfil_permissoes) sobre o BancoFalso. Só a sessão
// e o client admin são substituídos: permissão, organização e isolamento são
// decididos pelo mesmo código que roda no servidor.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { BancoFalso, type Linha } from './bancoFalso'

const estado = vi.hoisted(() => ({ usuarioId: null as string | null, banco: null as unknown }))

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: estado.usuarioId ? { id: estado.usuarioId } : null } }) },
  }),
}))
vi.mock('@/lib/supabase-admin', () => ({
  createSupabaseAdminClient: () => (estado.banco as BancoFalso).cliente(),
}))

import { GET as GET_LISTA, POST } from '@/app/api/templates/route'
import { DELETE, GET as GET_ID, PATCH } from '@/app/api/templates/[id]/route'

const ORG_A = 'aaaaaaaa-0000-4000-8000-000000000001'
const ORG_B = 'bbbbbbbb-0000-4000-8000-000000000002'

const ADMIN_A = 'aaaaaaaa-1111-4111-8111-00000000000a'
const COMERCIAL_A = 'aaaaaaaa-1111-4111-8111-00000000000c'
const SEM_TEMPLATES_A = 'aaaaaaaa-1111-4111-8111-00000000000d'
const ADMIN_B = 'bbbbbbbb-1111-4111-8111-00000000000a'

const T_A_EMAIL = 'aaaaaaaa-2222-4222-8222-000000000001'
const T_A_WHATS = 'aaaaaaaa-2222-4222-8222-000000000002'
const T_A_REATIVACAO = 'aaaaaaaa-2222-4222-8222-000000000003'
const T_A_COPIA = 'aaaaaaaa-2222-4222-8222-000000000004'
const T_B_EMAIL = 'bbbbbbbb-2222-4222-8222-000000000001'
const T_B_REATIVACAO = 'bbbbbbbb-2222-4222-8222-000000000002'
const INEXISTENTE = 'cccccccc-2222-4222-8222-000000000009'

const WF_A = 'aaaaaaaa-3333-4333-8333-000000000001'
const WF_B = 'bbbbbbbb-3333-4333-8333-000000000001'
const CAMP_A = 'aaaaaaaa-4444-4444-8444-000000000001'
const CAMP_B = 'bbbbbbbb-4444-4444-8444-000000000001'

const NAO_ENCONTRADO = { erro: 'Template não encontrado.' }

const grants = (org: string, perfil: string, permissoes: string[]): Linha[] =>
  permissoes.map((permissao) => ({ organizacao_id: org, perfil_id: perfil, permissao }))

const template = (id: string, org: string, dados: Linha): Linha => ({
  id,
  organizacao_id: org,
  nicho: null,
  assunto: null,
  html: null,
  ativo: true,
  created_at: '2026-09-01T00:00:00Z',
  atualizado_em: '2026-09-01T00:00:00Z',
  ...dados,
})

const definicao = (tipo: string) => ({
  gatilho: { tipo: 'manual', config: {} },
  condicoes: [],
  acoes: [{ id: 'email-0', tipo: 'enviar_email', config: { template: tipo } }],
})

function montarBanco() {
  return new BancoFalso({
    perfis: [
      { id: ADMIN_A, organizacao_id: ORG_A, role: 'admin' },
      { id: COMERCIAL_A, organizacao_id: ORG_A, role: 'usuario' },
      { id: SEM_TEMPLATES_A, organizacao_id: ORG_A, role: 'usuario' },
      { id: ADMIN_B, organizacao_id: ORG_B, role: 'admin' },
    ],
    perfil_permissoes: [
      ...grants(ORG_A, ADMIN_A, ['templates.view', 'templates.manage']),
      ...grants(ORG_A, COMERCIAL_A, ['campaigns.view', 'templates.view']),
      ...grants(ORG_A, SEM_TEMPLATES_A, ['campaigns.view']),
      ...grants(ORG_B, ADMIN_B, ['templates.view', 'templates.manage']),
    ],
    templates: [
      template(T_A_EMAIL, ORG_A, { nome: 'Renovação A', canal: 'email', tipo: 'renovacao_1', assunto: 'Validade', corpo: 'Renove' }),
      template(T_A_WHATS, ORG_A, { nome: 'WhatsApp A', canal: 'whatsapp', tipo: 'primeiro_contato', corpo: 'Oi da A' }),
      template(T_A_REATIVACAO, ORG_A, { nome: 'Reativação A', canal: 'email', tipo: 'reativacao_1', assunto: 'Retomada', corpo: 'Olá' }),
      template(T_A_COPIA, ORG_A, { nome: 'CAMPANHA — mensagem 1', canal: 'email', tipo: 'campanha_abc_m1', assunto: 'c', corpo: 'c' }),
      template(T_B_EMAIL, ORG_B, { nome: 'Segredo da B', canal: 'email', tipo: 'renovacao_1', assunto: 'Só B', corpo: 'Conteúdo sigiloso da B' }),
      template(T_B_REATIVACAO, ORG_B, { nome: 'Reativação B', canal: 'email', tipo: 'reativacao_1', assunto: 'B', corpo: 'B' }),
    ],
    workflows: [
      { id: WF_A, organizacao_id: ORG_A, nome: 'Reativação de clientes (A)', status: 'publicado', versao_atual_id: 'v-a7' },
      { id: WF_B, organizacao_id: ORG_B, nome: 'Fluxo secreto da B', status: 'publicado', versao_atual_id: 'v-b1' },
    ],
    workflow_versoes: [
      { id: 'v-a7', organizacao_id: ORG_A, workflow_id: WF_A, numero: 7, definicao: definicao('reativacao_1') },
      { id: 'v-b1', organizacao_id: ORG_B, workflow_id: WF_B, numero: 1, definicao: definicao('renovacao_1') },
    ],
    workflow_execucoes: [
      { id: 'e-a1', organizacao_id: ORG_A, workflow_id: WF_A, versao_id: 'v-a7', status: 'aguardando' },
      { id: 'e-a2', organizacao_id: ORG_A, workflow_id: WF_A, versao_id: 'v-a7', status: 'em_andamento' },
      { id: 'e-b1', organizacao_id: ORG_B, workflow_id: WF_B, versao_id: 'v-b1', status: 'aguardando' },
    ],
    campanhas: [
      { id: CAMP_A, organizacao_id: ORG_A, nome: 'Campanha ativa A', status: 'ativa', workflow_id: WF_A, publico: {} },
      { id: CAMP_B, organizacao_id: ORG_B, nome: 'Campanha secreta B', status: 'ativa', workflow_id: WF_B, publico: {} },
    ],
  })
}

let banco: BancoFalso

beforeEach(() => {
  banco = montarBanco()
  estado.banco = banco
  estado.usuarioId = ADMIN_A
})

const BASE = 'http://localhost/api/templates'
const contexto = (id: string) => ({ params: Promise.resolve({ id }) })
const JSON_HEADERS = { 'content-type': 'application/json' }

async function ler(resposta: Promise<Response>) {
  const r = await resposta
  return { status: r.status, corpo: await r.json() }
}

const api = {
  listar: (query = '') => ler(GET_LISTA(new NextRequest(`${BASE}${query}`))),
  criar: (corpo: unknown) =>
    ler(POST(new NextRequest(BASE, { method: 'POST', body: JSON.stringify(corpo), headers: JSON_HEADERS }))),
  abrir: (id: string) => ler(GET_ID(new NextRequest(`${BASE}/${id}`), contexto(id))),
  editar: (id: string, corpo: unknown) =>
    ler(PATCH(new NextRequest(`${BASE}/${id}`, { method: 'PATCH', body: JSON.stringify(corpo), headers: JSON_HEADERS }), contexto(id))),
  desativar: (id: string) => ler(DELETE(new NextRequest(`${BASE}/${id}`, { method: 'DELETE' }), contexto(id))),
}

const operacoesEmTemplates = () => banco.operacoes.filter((op) => op.tabela === 'templates')
const linhaTemplate = (id: string) => banco.linhas('templates').find((t) => t.id === id)
const linhasDe = (org: string) =>
  ['templates', 'workflows', 'workflow_versoes', 'workflow_execucoes', 'campanhas'].flatMap((tabela) =>
    banco.copia(tabela).filter((linha) => linha.organizacao_id === org),
  )

const NOVO_EMAIL = { nome: 'FUP 1', canal: 'email', tipo: 'follow_up_1', assunto: 'Retomando', corpo: 'Olá {nome}' }

describe('autenticação e permissão', () => {
  it('1. GET sem sessão → 401', async () => {
    estado.usuarioId = null
    expect(await api.listar()).toEqual({ status: 401, corpo: { erro: 'Não autenticado' } })
    expect((await api.abrir(T_A_EMAIL)).status).toBe(401)
    expect(operacoesEmTemplates()).toEqual([])
  })

  it('2. POST sem sessão → 401', async () => {
    estado.usuarioId = null
    expect((await api.criar(NOVO_EMAIL)).status).toBe(401)
    expect(banco.escritas()).toEqual([])
  })

  it('3. sem templates.view → 403 na listagem e no GET por id', async () => {
    estado.usuarioId = SEM_TEMPLATES_A
    expect((await api.listar()).status).toBe(403)
    expect((await api.abrir(T_A_EMAIL)).status).toBe(403)
    expect(operacoesEmTemplates()).toEqual([])
  })

  it('4. sem templates.manage → 403 em POST, PATCH e DELETE (mas lista)', async () => {
    estado.usuarioId = COMERCIAL_A
    expect((await api.listar()).status).toBe(200)
    expect((await api.criar(NOVO_EMAIL)).status).toBe(403)
    expect((await api.editar(T_A_EMAIL, { nome: 'x' })).status).toBe(403)
    expect((await api.desativar(T_A_EMAIL)).status).toBe(403)
    expect(banco.escritas()).toEqual([])
  })
})

describe('listagem', () => {
  it('5. lista só a organização da sessão, em ordem determinística e sem organizacao_id', async () => {
    const a = await api.listar()
    expect(a.status).toBe(200)
    expect(a.corpo.templates.map((t: { nome: string }) => t.nome)).toEqual(['Reativação A', 'Renovação A', 'WhatsApp A'])
    expect(JSON.stringify(a.corpo)).not.toContain('Segredo')
    for (const t of a.corpo.templates) expect(t).not.toHaveProperty('organizacao_id')

    estado.usuarioId = ADMIN_B
    const b = await api.listar()
    expect(b.corpo.templates.map((t: { nome: string }) => t.nome)).toEqual(['Reativação B', 'Segredo da B'])
  })

  it('7. organizacao_id na query string é ignorado', async () => {
    const r = await api.listar(`?organizacao_id=${ORG_B}&ativo=todos`)
    expect(r.corpo.templates.map((t: { id: string }) => t.id).sort()).toEqual([T_A_EMAIL, T_A_REATIVACAO, T_A_WHATS].sort())
  })

  it('15. cópias campanha_* não aparecem, nem com ativo=todos', async () => {
    const r = await api.listar('?ativo=todos')
    expect(r.corpo.templates.map((t: { id: string }) => t.id)).not.toContain(T_A_COPIA)
  })

  it('filtros de canal, formato, busca e ativo; valor inválido → 400', async () => {
    const ids = async (query: string) => (await api.listar(query)).corpo.templates.map((t: { id: string }) => t.id)
    expect(await ids('?canal=whatsapp')).toEqual([T_A_WHATS])
    expect(await ids('?formato=texto')).toHaveLength(3)
    expect(await ids('?formato=html')).toEqual([])
    expect(await ids('?busca=Segredo')).toEqual([])
    expect(await ids('?nome=renova')).toEqual([T_A_EMAIL])
    expect(await ids('?ativo=false')).toEqual([])
    expect((await api.listar('?canal=sms')).status).toBe(400)
    expect((await api.listar('?ativo=talvez')).status).toBe(400)
    expect((await api.listar('?formato=pdf')).status).toBe(400)
  })
})

describe('criação', () => {
  it('6. POST grava na organização da sessão e 7. ignora organizacao_id e autoria do corpo', async () => {
    const r = await api.criar({ ...NOVO_EMAIL, organizacao_id: ORG_B, criado_por: ADMIN_B, id: T_B_EMAIL })
    expect(r.status).toBe(201)
    expect(r.corpo.template).not.toHaveProperty('organizacao_id')
    expect(r.corpo.template.id).not.toBe(T_B_EMAIL)
    expect(linhaTemplate(r.corpo.template.id)).toMatchObject({
      organizacao_id: ORG_A,
      criado_por: ADMIN_A,
      atualizado_por: ADMIN_A,
      ativo: true,
    })
    expect(banco.linhas('templates').filter((t) => t.organizacao_id === ORG_B)).toHaveLength(2)
  })

  it('17. HTML em WhatsApp é rejeitado sem gravar', async () => {
    const r = await api.criar({ nome: 'WA', canal: 'whatsapp', tipo: 'fup', corpo: 'oi', html: '<p>oi</p>' })
    expect(r).toEqual({ status: 400, corpo: { erro: 'HTML só é permitido em templates de e-mail.' } })
    expect(banco.escritas()).toEqual([])
  })

  it('18. HTML de e-mail é salvo sanitizado e devolvido igual pelo GET', async () => {
    const r = await api.criar({
      nome: 'Novidade',
      canal: 'email',
      tipo: 'novidade',
      assunto: 'Novidade para {{empresa}}',
      html: '<p onclick="roubar()">Oi {{nome}}, <a href="https://art.com.br/?a=1&b=2">veja</a></p><script>alert(1)</script>',
    })
    expect(r.status).toBe(201)
    const html = '<p>Oi {{nome}}, <a href="https://art.com.br/?a=1&amp;b=2">veja</a></p>'
    expect(r.corpo.template).toMatchObject({ formato: 'html', html, corpo: 'Oi {{nome}}, veja' })
    expect(linhaTemplate(r.corpo.template.id)?.html).toBe(html)
    expect((await api.abrir(r.corpo.template.id)).corpo.template.html).toBe(html)
    expect((await api.listar('?formato=html')).corpo.templates.map((t: { id: string }) => t.id)).toEqual([r.corpo.template.id])
  })

  it('valida tipo reservado, ativo, JSON e cria inativo quando pedido', async () => {
    expect((await api.criar({ ...NOVO_EMAIL, tipo: 'campanha_x_m1' })).status).toBe(400)
    expect((await api.criar({ ...NOVO_EMAIL, ativo: 'sim' })).status).toBe(400)
    const invalido = await ler(POST(new NextRequest(BASE, { method: 'POST', body: '{nao-e-json', headers: JSON_HEADERS })))
    expect(invalido.status).toBe(400)
    expect(banco.escritas()).toEqual([])
    const inativo = await api.criar({ ...NOVO_EMAIL, ativo: false })
    expect(inativo.corpo.template.ativo).toBe(false)
  })
})

describe('isolamento por id', () => {
  it('8. GET cross-org → 404 idêntico ao inexistente, nas duas direções', async () => {
    expect(await api.abrir(T_B_EMAIL)).toEqual({ status: 404, corpo: NAO_ENCONTRADO })
    expect(await api.abrir(INEXISTENTE)).toEqual({ status: 404, corpo: NAO_ENCONTRADO })
    estado.usuarioId = ADMIN_B
    expect(await api.abrir(T_A_EMAIL)).toEqual({ status: 404, corpo: NAO_ENCONTRADO })
    expect((await api.abrir(T_B_EMAIL)).corpo.template.nome).toBe('Segredo da B')
  })

  it('9. PATCH cross-org → 404 e nada escrito, nas duas direções', async () => {
    const antes = banco.copia('templates')
    expect(await api.editar(T_B_EMAIL, { nome: 'Invadido' })).toEqual({ status: 404, corpo: NAO_ENCONTRADO })
    estado.usuarioId = ADMIN_B
    expect(await api.editar(T_A_EMAIL, { nome: 'Invadido' })).toEqual({ status: 404, corpo: NAO_ENCONTRADO })
    expect(banco.escritas()).toEqual([])
    expect(banco.copia('templates')).toEqual(antes)
  })

  it('10. DELETE cross-org → 404 (nem revela uso) e nada muda, nas duas direções', async () => {
    const antes = banco.copia('templates')
    expect(await api.desativar(T_B_EMAIL)).toEqual({ status: 404, corpo: NAO_ENCONTRADO })
    estado.usuarioId = ADMIN_B
    // Na própria organização este daria 409 (em uso); para a B é só "não encontrado".
    expect(await api.desativar(T_A_REATIVACAO)).toEqual({ status: 404, corpo: NAO_ENCONTRADO })
    expect(banco.escritas()).toEqual([])
    expect(banco.copia('templates')).toEqual(antes)
  })

  it('11. UUID inválido → 404 sem consultar templates', async () => {
    for (const id of ['nao-e-uuid', "1' or '1'='1"]) {
      expect(await api.abrir(id)).toEqual({ status: 404, corpo: NAO_ENCONTRADO })
      expect(await api.editar(id, { nome: 'x' })).toEqual({ status: 404, corpo: NAO_ENCONTRADO })
      expect(await api.desativar(id)).toEqual({ status: 404, corpo: NAO_ENCONTRADO })
    }
    expect(operacoesEmTemplates()).toEqual([])
  })
})

describe('edição', () => {
  it('12. PATCH não muda organização, canal, estágio nem segmento', async () => {
    const antes = linhaTemplate(T_A_EMAIL)
    for (const troca of [{ tipo: 'follow_up_1' }, { canal: 'whatsapp' }, { nicho: 'varejo' }]) {
      expect((await api.editar(T_A_EMAIL, troca)).status).toBe(400)
    }
    expect(await api.editar(T_A_EMAIL, { organizacao_id: ORG_B })).toEqual({
      status: 400,
      corpo: { erro: 'Nenhum campo editável informado.' },
    })
    expect(banco.escritas()).toEqual([])
    expect(linhaTemplate(T_A_EMAIL)).toEqual(antes)
  })

  it('PATCH de conteúdo sanitiza o HTML novo, refaz o texto e carimba o autor', async () => {
    const r = await api.editar(T_A_EMAIL, {
      nome: 'Renovação do laudo',
      html: '<p>Novo <b>texto</b></p><script>alert(1)</script>',
      organizacao_id: ORG_B,
    })
    expect(r.status).toBe(200)
    expect(r.corpo.template).toMatchObject({ nome: 'Renovação do laudo', html: '<p>Novo <b>texto</b></p>', corpo: 'Novo texto' })
    expect(linhaTemplate(T_A_EMAIL)).toMatchObject({ organizacao_id: ORG_A, atualizado_por: ADMIN_A, canal: 'email', tipo: 'renovacao_1' })
  })

  it('PATCH só do nome não reescreve o HTML já gravado', async () => {
    const html = '<a href="https://art.com.br/?a=1&amp;b=2">Renovar</a>'
    Object.assign(linhaTemplate(T_A_EMAIL)!, { html, corpo: 'Renovar' })
    expect((await api.editar(T_A_EMAIL, { nome: 'Outro nome' })).status).toBe(200)
    expect(linhaTemplate(T_A_EMAIL)?.html).toBe(html)
  })

  it('PATCH de ativo: inválido → 400; desativar em uso → 409; reativar funciona', async () => {
    expect((await api.editar(T_A_EMAIL, { ativo: 'nao' })).status).toBe(400)
    expect((await api.editar(T_A_REATIVACAO, { ativo: false, nome: 'x' })).status).toBe(409)
    expect(linhaTemplate(T_A_REATIVACAO)).toMatchObject({ ativo: true, nome: 'Reativação A' })
    expect((await api.editar(T_A_EMAIL, { ativo: false })).corpo.template.ativo).toBe(false)
    expect((await api.editar(T_A_EMAIL, { ativo: true })).corpo.template.ativo).toBe(true)
  })

  it('16. cópia campanha_*: GET 404, PATCH e DELETE 409, nada escrito', async () => {
    expect(await api.abrir(T_A_COPIA)).toEqual({ status: 404, corpo: NAO_ENCONTRADO })
    expect((await api.editar(T_A_COPIA, { nome: 'x' })).status).toBe(409)
    expect((await api.desativar(T_A_COPIA)).status).toBe(409)
    expect(banco.escritas()).toEqual([])
  })
})

describe('DELETE = desativar', () => {
  it('13. só desativa: a linha continua, some da listagem padrão e aparece em ativo=false', async () => {
    const r = await api.desativar(T_A_EMAIL)
    expect(r.status).toBe(200)
    expect(r.corpo.template.ativo).toBe(false)
    expect(linhaTemplate(T_A_EMAIL)).toMatchObject({ ativo: false, atualizado_por: ADMIN_A })
    expect(banco.operacoes.some((op) => op.tipo === 'delete')).toBe(false)
    expect((await api.listar()).corpo.templates.map((t: { id: string }) => t.id)).not.toContain(T_A_EMAIL)
    expect((await api.listar('?ativo=false')).corpo.templates.map((t: { id: string }) => t.id)).toEqual([T_A_EMAIL])
    expect((await api.abrir(T_A_EMAIL)).corpo.template.ativo).toBe(false)
    expect((await api.desativar(T_A_EMAIL)).status).toBe(200)
  })

  it('14. template em uso → 409 listando só os usos da própria organização, sem alterar nada', async () => {
    const r = await api.desativar(T_A_REATIVACAO)
    expect(r.status).toBe(409)
    expect(r.corpo.usos).toEqual([
      { tipo: 'workflow', id: WF_A, nome: 'Reativação de clientes (A)', status: 'publicado', versao: 7 },
      { tipo: 'execucoes', quantidade: 2 },
      { tipo: 'campanha', id: CAMP_A, nome: 'Campanha ativa A', status: 'ativa' },
    ])
    const texto = JSON.stringify(r.corpo)
    for (const vazamento of ['secret', WF_B, CAMP_B, ORG_B]) expect(texto).not.toContain(vazamento)
    expect(linhaTemplate(T_A_REATIVACAO)?.ativo).toBe(true)
    expect(banco.escritas()).toEqual([])
  })

  it('uso na outra organização não bloqueia nem aparece', async () => {
    // O workflow publicado da B envia `renovacao_1`; o `renovacao_1` da A está livre.
    const r = await api.desativar(T_A_EMAIL)
    expect(r.status).toBe(200)
    expect(JSON.stringify(r.corpo)).not.toContain('secreto')
  })

  it('com variante ativa assumindo o lugar, desativar deixa de ser bloqueado', async () => {
    expect((await api.criar({ nome: 'Reativação A · variante', canal: 'email', tipo: 'reativacao_1', assunto: 'R', corpo: 'Olá' })).status).toBe(201)
    expect((await api.desativar(T_A_REATIVACAO)).status).toBe(200)
  })
})

describe('19. nenhuma operação afeta outra organização', () => {
  it('sessão A: tudo o que ela faz (ou tenta) deixa a B idêntica e só consulta a A', async () => {
    const antesB = linhasDe(ORG_B)
    await api.listar('?ativo=todos&busca=a')
    const criado = await api.criar(NOVO_EMAIL)
    await api.editar(criado.corpo.template.id, { nome: 'FUP 1 revisado' })
    await api.editar(T_A_EMAIL, { corpo: 'Renove já' })
    await api.desativar(T_A_WHATS)
    await api.desativar(T_A_REATIVACAO)
    await api.abrir(T_B_EMAIL)
    await api.editar(T_B_EMAIL, { nome: 'Invadido' })
    await api.desativar(T_B_REATIVACAO)

    expect(linhasDe(ORG_B)).toEqual(antesB)
    const tabelasDeTenant = new Set(['templates', 'workflows', 'workflow_versoes', 'workflow_execucoes', 'campanhas', 'leads'])
    for (const op of banco.operacoes.filter((o) => tabelasDeTenant.has(o.tabela))) {
      if (op.tipo === 'insert') expect(op.payload).toMatchObject({ organizacao_id: ORG_A })
      else expect(op.filtros).toContainEqual({ op: 'eq', coluna: 'organizacao_id', valor: ORG_A })
      expect(JSON.stringify(op)).not.toContain(ORG_B)
    }
  })
})
