// Isolamento multi-tenant da biblioteca de templates no NÍVEL DO CÓDIGO. O
// repositório usa service_role (ignora RLS), então o isolamento depende de
// sempre escopar organizacao_id. O BancoFalso aplica os filtros de verdade:
// se um caminho esquecer a organização, a linha da outra aparece e o teste falha.
import { describe, expect, it } from 'vitest'
import { BancoFalso } from './bancoFalso'
import {
  ErroTemplate,
  MENSAGEM_TEMPLATE_NAO_ENCONTRADO,
  atualizarTemplate,
  buscarTemplate,
  criarTemplate,
  definirAtivoTemplate,
  listarTemplates,
} from '../repository'

const ORG_A = 'aaaaaaaa-0000-4000-8000-000000000001'
const ORG_B = 'bbbbbbbb-0000-4000-8000-000000000002'
const PERFIL_A = 'aaaaaaaa-1111-4111-8111-000000000001'
const PERFIL_B = 'bbbbbbbb-1111-4111-8111-000000000002'

const A_HTML = 'aaaaaaaa-2222-4222-8222-000000000001'
const A_WHATS = 'aaaaaaaa-2222-4222-8222-000000000002'
const A_INATIVO = 'aaaaaaaa-2222-4222-8222-000000000003'
const A_COPIA = 'aaaaaaaa-2222-4222-8222-000000000004'
const B_HTML = 'bbbbbbbb-2222-4222-8222-000000000001'
const B_WHATS = 'bbbbbbbb-2222-4222-8222-000000000002'
const INEXISTENTE = 'cccccccc-2222-4222-8222-000000000009'

function linha(id: string, org: string, dados: Record<string, unknown>) {
  return {
    id,
    organizacao_id: org,
    nicho: null,
    assunto: null,
    html: null,
    ativo: true,
    created_at: '2026-09-01T00:00:00Z',
    atualizado_em: '2026-09-01T00:00:00Z',
    ...dados,
  }
}

function montarBanco() {
  return new BancoFalso({
    templates: [
      linha(A_HTML, ORG_A, { nome: 'Renovação A', canal: 'email', tipo: 'renovacao_1', assunto: 'Validade', corpo: 'Renove', html: '<p>Renove</p>' }),
      linha(A_WHATS, ORG_A, { nome: 'WhatsApp A', canal: 'whatsapp', tipo: 'primeiro_contato', corpo: 'Oi da A' }),
      linha(A_INATIVO, ORG_A, { nome: 'Antigo A', canal: 'email', tipo: 'follow_up_2', assunto: 'x', corpo: 'x', ativo: false }),
      linha(A_COPIA, ORG_A, { nome: 'CAMPANHA — mensagem 1', canal: 'email', tipo: 'campanha_d283b6e4_m1', assunto: 'c', corpo: 'c' }),
      linha(B_HTML, ORG_B, { nome: 'Segredo da B', canal: 'email', tipo: 'renovacao_1', assunto: 'Só B', corpo: 'Conteúdo sigiloso da B', html: '<p>B</p>' }),
      linha(B_WHATS, ORG_B, { nome: 'WhatsApp B', canal: 'whatsapp', tipo: 'primeiro_contato', corpo: 'Oi da B' }),
    ],
  })
}

async function erroDe(promessa: Promise<unknown>): Promise<ErroTemplate> {
  try {
    await promessa
  } catch (e) {
    if (e instanceof ErroTemplate) return e
    throw e
  }
  throw new Error('esperava ErroTemplate')
}

describe('biblioteca de templates — leitura isolada por organização', () => {
  it('A vê só A e B vê só B, sem expor organizacao_id', async () => {
    const banco = montarBanco()
    const daA = await listarTemplates(banco.cliente(), ORG_A)
    const daB = await listarTemplates(banco.cliente(), ORG_B)
    expect(daA.map((t) => t.id).sort()).toEqual([A_HTML, A_WHATS].sort())
    expect(daB.map((t) => t.id).sort()).toEqual([B_HTML, B_WHATS].sort())
    expect(JSON.stringify(daA)).not.toContain('Segredo da B')
    for (const t of [...daA, ...daB]) expect(t).not.toHaveProperty('organizacao_id')
  })

  it('cópias de campanha ficam fora; inativos só quando pedidos', async () => {
    const banco = montarBanco()
    const todos = await listarTemplates(banco.cliente(), ORG_A, { ativo: 'todos' })
    expect(todos.map((t) => t.id).sort()).toEqual([A_HTML, A_WHATS, A_INATIVO].sort())
  })

  it('filtros de canal, formato e busca não atravessam a organização', async () => {
    const banco = montarBanco()
    const c = banco.cliente()
    expect((await listarTemplates(c, ORG_A, { busca: 'Segredo' }))).toEqual([])
    expect((await listarTemplates(c, ORG_A, { busca: '%' })).map((t) => t.id).sort()).toEqual([A_HTML, A_WHATS].sort())
    expect((await listarTemplates(c, ORG_A, { canal: 'whatsapp' })).map((t) => t.id)).toEqual([A_WHATS])
    expect((await listarTemplates(c, ORG_A, { formato: 'html' })).map((t) => t.id)).toEqual([A_HTML])
    expect((await listarTemplates(c, ORG_A, { formato: 'texto' })).map((t) => t.id)).toEqual([A_WHATS])
  })

  it('GET direto de A no id de B devolve o mesmo "não encontrado" de um id inexistente', async () => {
    const banco = montarBanco()
    expect(await buscarTemplate(banco.cliente(), ORG_A, B_HTML)).toBeNull()
    expect(await buscarTemplate(banco.cliente(), ORG_A, INEXISTENTE)).toBeNull()
    expect((await buscarTemplate(banco.cliente(), ORG_B, B_HTML))?.nome).toBe('Segredo da B')
  })

  it('id que não é UUID nem chega ao banco', async () => {
    const banco = montarBanco()
    expect(await buscarTemplate(banco.cliente(), ORG_A, "' or 1=1 --")).toBeNull()
    expect(banco.operacoes).toEqual([])
  })
})

describe('biblioteca de templates — escrita isolada por organização', () => {
  it('UPDATE de A no template de B: 404 idêntico ao inexistente e B intacta', async () => {
    const banco = montarBanco()
    const antesB = banco.copia('templates').filter((t) => t.organizacao_id === ORG_B)
    const cruzado = await erroDe(atualizarTemplate(banco.cliente(), ORG_A, PERFIL_A, B_HTML, { nome: 'Invadido', corpo: 'x' }))
    const inexistente = await erroDe(atualizarTemplate(banco.cliente(), ORG_A, PERFIL_A, INEXISTENTE, { nome: 'x' }))
    expect([cruzado.status, cruzado.message]).toEqual([404, MENSAGEM_TEMPLATE_NAO_ENCONTRADO])
    expect([inexistente.status, inexistente.message]).toEqual([cruzado.status, cruzado.message])
    expect(banco.escritas()).toEqual([])
    expect(banco.copia('templates').filter((t) => t.organizacao_id === ORG_B)).toEqual(antesB)
  })

  it('DELETE (desativar) de A no template de B: 404 e B continua ativo', async () => {
    const banco = montarBanco()
    const erro = await erroDe(definirAtivoTemplate(banco.cliente(), ORG_A, PERFIL_A, B_WHATS, false))
    expect(erro.status).toBe(404)
    expect(banco.escritas()).toEqual([])
    expect(banco.linhas('templates').find((t) => t.id === B_WHATS)?.ativo).toBe(true)
  })

  it('CREATE ignora organizacao_id do corpo e grava na organização da sessão', async () => {
    const banco = montarBanco()
    const criado = await criarTemplate(banco.cliente(), ORG_A, PERFIL_A, {
      nome: 'FUP 1',
      canal: 'email',
      tipo: 'follow_up_1',
      assunto: 'Retomando',
      corpo: 'Olá {nome}',
      organizacao_id: ORG_B,
    })
    const gravado = banco.linhas('templates').find((t) => t.id === criado.id)
    expect(gravado).toMatchObject({ organizacao_id: ORG_A, criado_por: PERFIL_A, atualizado_por: PERFIL_A, ativo: true })
    expect(banco.linhas('templates').filter((t) => t.organizacao_id === ORG_B)).toHaveLength(2)
    expect(criado).not.toHaveProperty('organizacao_id')
  })

  it('UPDATE na própria organização: filtra org + id, carimba autor e não troca a organização', async () => {
    const banco = montarBanco()
    const editado = await atualizarTemplate(banco.cliente(), ORG_B, PERFIL_B, B_HTML, { nome: 'Renovação B', organizacao_id: ORG_A })
    expect(editado.nome).toBe('Renovação B')
    expect(banco.linhas('templates').find((t) => t.id === B_HTML)).toMatchObject({ organizacao_id: ORG_B, atualizado_por: PERFIL_B })
    const [update] = banco.escritas('templates')
    expect(update.filtros).toEqual(expect.arrayContaining([
      { op: 'eq', coluna: 'organizacao_id', valor: ORG_B },
      { op: 'eq', coluna: 'id', valor: B_HTML },
    ]))
    expect(update.payload).not.toHaveProperty('organizacao_id')
  })

  it('cópia de campanha é somente leitura: editar ou desativar dá 409 e nada muda', async () => {
    const banco = montarBanco()
    expect((await erroDe(atualizarTemplate(banco.cliente(), ORG_A, PERFIL_A, A_COPIA, { nome: 'x' }))).status).toBe(409)
    expect((await erroDe(definirAtivoTemplate(banco.cliente(), ORG_A, PERFIL_A, A_COPIA, false))).status).toBe(409)
    expect(banco.escritas()).toEqual([])
  })

  it('trocar a chave (estágio) na edição é recusado com 400', async () => {
    const banco = montarBanco()
    const erro = await erroDe(atualizarTemplate(banco.cliente(), ORG_A, PERFIL_A, A_HTML, { tipo: 'follow_up_1' }))
    expect(erro.status).toBe(400)
    expect(banco.escritas()).toEqual([])
  })

  it('desativar e reativar na própria organização; repetir é idempotente', async () => {
    const banco = montarBanco()
    const c = banco.cliente()
    expect((await definirAtivoTemplate(c, ORG_A, PERFIL_A, A_WHATS, false)).ativo).toBe(false)
    expect((await listarTemplates(c, ORG_A)).map((t) => t.id)).toEqual([A_HTML])
    await definirAtivoTemplate(c, ORG_A, PERFIL_A, A_WHATS, false)
    expect(banco.escritas('templates')).toHaveLength(1)
    expect((await definirAtivoTemplate(c, ORG_A, PERFIL_A, A_WHATS, true)).ativo).toBe(true)
  })

  it('nenhuma operação da Org A menciona a Org B', async () => {
    const banco = montarBanco()
    const c = banco.cliente()
    await listarTemplates(c, ORG_A, { ativo: 'todos', busca: 'a' })
    await buscarTemplate(c, ORG_A, B_HTML)
    await criarTemplate(c, ORG_A, PERFIL_A, { nome: 'n', canal: 'whatsapp', tipo: 'fup', corpo: 'c' })
    await atualizarTemplate(c, ORG_A, PERFIL_A, A_HTML, { nome: 'n2' })
    await definirAtivoTemplate(c, ORG_A, PERFIL_A, A_WHATS, false)
    await erroDe(atualizarTemplate(c, ORG_A, PERFIL_A, B_HTML, { nome: 'n3' }))
    expect(banco.operacoes.some((op) => op.tipo === 'insert')).toBe(true)
    for (const op of banco.operacoes) {
      if (op.tipo === 'insert') {
        expect(op.payload).toMatchObject({ organizacao_id: ORG_A })
      } else {
        expect(op.filtros).toContainEqual({ op: 'eq', coluna: 'organizacao_id', valor: ORG_A })
      }
      expect(JSON.stringify(op)).not.toContain(ORG_B)
    }
  })
})
