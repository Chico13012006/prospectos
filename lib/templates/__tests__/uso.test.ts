// Regras de "template em uso" (o que bloqueia a desativação), sobre o BancoFalso.
import { describe, expect, it } from 'vitest'
import { BancoFalso, type Linha } from './bancoFalso'
import { buscarUsosImpeditivos } from '../uso'
import { referenciasDaCampanha, tiposDeTemplateNaDefinicao } from '../referencias'

const ORG = 'aaaaaaaa-0000-4000-8000-000000000001'
const OUTRA = 'bbbbbbbb-0000-4000-8000-000000000002'

type Alvo = { id: string; canal: 'email' | 'whatsapp'; tipo: string; nicho: string | null }
const ALVO: Alvo = { id: 't-alvo', canal: 'email', tipo: 'follow_up_1', nicho: null }

const email = (id: string, org: string, tipo: string, nicho: string | null = null, ativo = true): Linha =>
  ({ id, organizacao_id: org, canal: 'email', tipo, nicho, ativo })

const definicao = (...tipos: string[]) => ({
  gatilho: { tipo: 'manual', config: {} },
  condicoes: [],
  acoes: tipos.map((tipo, i) => ({ id: `email-${i}`, tipo: 'enviar_email', config: { template: tipo } })),
})

const lead = (org: string, dados: Partial<Linha>): Linha => ({
  organizacao_id: org,
  owner: 'engine',
  estagio: 'follow_up',
  segmento: null,
  perdido: false,
  optout: false,
  bounced: false,
  ...dados,
})

describe('tiposDeTemplateNaDefinicao', () => {
  it('lê template, tipo e o padrão follow_up_1, inclui o ramificar legado e ignora outros blocos', () => {
    const tipos = tiposDeTemplateNaDefinicao({
      acoes: [
        { tipo: 'esperar', config: { dias: 2 } },
        { tipo: 'enviar_email', config: { template: 'reativacao_1' } },
        { tipo: 'enviar_email', config: { tipo: 'renovacao_1' } },
        { tipo: 'enviar_email', config: {} },
        {
          tipo: 'ramificar',
          config: {
            condicao: { tipo: 'campo', config: {} },
            entao: [{ tipo: 'enviar_email', config: { template: 'reativacao_3' } }],
            senao: [{ tipo: 'enviar_email', config: { template: 'reativacao_3b' } }],
          },
        },
        { tipo: 'enviar_whatsapp', config: { texto: 'oi', template: 'nao_conta' } },
      ],
    })
    expect([...tipos].sort()).toEqual(['follow_up_1', 'reativacao_1', 'reativacao_3', 'reativacao_3b', 'renovacao_1'])
  })

  it('definição nula ou malformada não referencia nada', () => {
    expect(tiposDeTemplateNaDefinicao(null).size).toBe(0)
    expect(tiposDeTemplateNaDefinicao({ acoes: 'x' }).size).toBe(0)
  })
})

describe('referenciasDaCampanha', () => {
  it('junta templateId e templateTipo da mensagem inicial e dos follow-ups, sem a origem', () => {
    const r = referenciasDaCampanha({
      operacao: {
        mensagemInicial: { templateId: 'id-1', templateTipo: 'campanha_x_m1', templateOrigemId: 'origem' },
        followups: [{ templateTipo: 'teste_fup' }, null],
      },
    })
    expect([...r.ids]).toEqual(['id-1'])
    expect([...r.tipos].sort()).toEqual(['campanha_x_m1', 'teste_fup'])
  })
})

describe('buscarUsosImpeditivos', () => {
  it('template que não é de e-mail nunca bloqueia e nem consulta o banco', async () => {
    const banco = new BancoFalso({
      workflows: [{ id: 'w', organizacao_id: ORG, nome: 'W', status: 'publicado', versao_atual_id: 'v' }],
      workflow_versoes: [{ id: 'v', organizacao_id: ORG, numero: 1, definicao: definicao('primeiro_contato') }],
    })
    const usos = await buscarUsosImpeditivos(banco.cliente(), ORG, { ...ALVO, canal: 'whatsapp', tipo: 'primeiro_contato' })
    expect(usos).toEqual([])
    expect(banco.operacoes).toEqual([])
  })

  it('outra variante ativa com a mesma chave assume o lugar: não bloqueia', async () => {
    const banco = new BancoFalso({
      templates: [email(ALVO.id, ORG, 'follow_up_1'), email('variante', ORG, 'follow_up_1')],
      workflows: [{ id: 'w', organizacao_id: ORG, nome: 'W', status: 'publicado', versao_atual_id: 'v' }],
      workflow_versoes: [{ id: 'v', organizacao_id: ORG, numero: 1, definicao: definicao('follow_up_1') }],
    })
    expect(await buscarUsosImpeditivos(banco.cliente(), ORG, ALVO)).toEqual([])
  })

  it('template de nicho com genérico ativo não bloqueia; genérico com só variante de nicho bloqueia', async () => {
    const base = {
      workflows: [{ id: 'w', organizacao_id: ORG, nome: 'W', status: 'publicado', versao_atual_id: 'v' }],
      workflow_versoes: [{ id: 'v', organizacao_id: ORG, numero: 3, definicao: definicao('reativacao_1') }],
    }
    const deNicho = new BancoFalso({
      ...base,
      templates: [email(ALVO.id, ORG, 'reativacao_1', 'hotelaria'), email('generico', ORG, 'reativacao_1')],
    })
    expect(await buscarUsosImpeditivos(deNicho.cliente(), ORG, { ...ALVO, tipo: 'reativacao_1', nicho: 'hotelaria' })).toEqual([])

    const generico = new BancoFalso({
      ...base,
      templates: [email(ALVO.id, ORG, 'reativacao_1'), email('hotel', ORG, 'reativacao_1', 'hotelaria')],
    })
    expect(await buscarUsosImpeditivos(generico.cliente(), ORG, { ...ALVO, tipo: 'reativacao_1' })).toEqual([
      { tipo: 'workflow', id: 'w', nome: 'W', status: 'publicado', versao: 3 },
    ])
  })

  it('workflows e execuções: publicado e pausado bloqueiam; rascunho e versão atual sem uso não; execução conta pela versão em que começou', async () => {
    const banco = new BancoFalso({
      templates: [email(ALVO.id, ORG, 'reativacao_1')],
      workflows: [
        { id: 'w-pub', organizacao_id: ORG, nome: 'A publicado', status: 'publicado', versao_atual_id: 'v1' },
        { id: 'w-pau', organizacao_id: ORG, nome: 'B pausado', status: 'pausado', versao_atual_id: 'v2' },
        { id: 'w-ras', organizacao_id: ORG, nome: 'C rascunho', status: 'rascunho', versao_atual_id: null, rascunho_definicao: definicao('reativacao_1') },
        { id: 'w-nov', organizacao_id: ORG, nome: 'D republicado', status: 'publicado', versao_atual_id: 'v4' },
      ],
      workflow_versoes: [
        { id: 'v1', organizacao_id: ORG, numero: 1, definicao: definicao('reativacao_1') },
        { id: 'v2', organizacao_id: ORG, numero: 2, definicao: definicao('esperar', 'reativacao_1') },
        { id: 'v3', organizacao_id: ORG, numero: 3, definicao: definicao('reativacao_1') },
        { id: 'v4', organizacao_id: ORG, numero: 4, definicao: definicao('renovacao_1') },
      ],
      workflow_execucoes: [
        { id: 'e1', organizacao_id: ORG, versao_id: 'v3', status: 'aguardando' },
        { id: 'e2', organizacao_id: ORG, versao_id: 'v1', status: 'concluido' },
        { id: 'e3', organizacao_id: ORG, versao_id: 'v4', status: 'em_andamento' },
        { id: 'e4', organizacao_id: OUTRA, versao_id: 'v1', status: 'aguardando' },
      ],
    })
    expect(await buscarUsosImpeditivos(banco.cliente(), ORG, { ...ALVO, tipo: 'reativacao_1' })).toEqual([
      { tipo: 'workflow', id: 'w-pub', nome: 'A publicado', status: 'publicado', versao: 1 },
      { tipo: 'workflow', id: 'w-pau', nome: 'B pausado', status: 'pausado', versao: 2 },
      { tipo: 'execucoes', quantidade: 1 },
    ])
  })

  it('campanhas: ativa/pausada que envia pelo template bloqueia; concluída, rascunho e só-origem não', async () => {
    const banco = new BancoFalso({
      templates: [email(ALVO.id, ORG, 'reativacao_1')],
      workflows: [{ id: 'w', organizacao_id: ORG, nome: 'W', status: 'publicado', versao_atual_id: 'v' }],
      workflow_versoes: [{ id: 'v', organizacao_id: ORG, numero: 1, definicao: definicao('reativacao_1') }],
      campanhas: [
        { id: 'c1', organizacao_id: ORG, nome: 'C1 ativa pelo workflow', status: 'ativa', workflow_id: 'w', publico: {} },
        { id: 'c2', organizacao_id: ORG, nome: 'C2 pausada legado', status: 'pausada', workflow_id: null, publico: { operacao: { mensagemInicial: { templateTipo: 'reativacao_1' } } } },
        { id: 'c3', organizacao_id: ORG, nome: 'C3 concluída', status: 'concluida', workflow_id: 'w', publico: {} },
        { id: 'c4', organizacao_id: ORG, nome: 'C4 rascunho', status: 'rascunho', workflow_id: null, publico: { operacao: { mensagemInicial: { templateId: ALVO.id } } } },
        { id: 'c5', organizacao_id: ORG, nome: 'C5 só origem', status: 'ativa', workflow_id: null, publico: { operacao: { mensagemInicial: { templateOrigemId: ALVO.id } } } },
        { id: 'c6', organizacao_id: ORG, nome: 'C6 follow-up por id', status: 'ativa', workflow_id: null, publico: { operacao: { followups: [{ templateId: ALVO.id }] } } },
      ],
    })
    const usos = await buscarUsosImpeditivos(banco.cliente(), ORG, { ...ALVO, tipo: 'reativacao_1' })
    expect(usos.filter((u) => u.tipo === 'campanha').map((u) => (u as { id: string }).id)).toEqual(['c1', 'c2', 'c6'])
  })

  it('motor de cadência: conta só leads do motor elegíveis, na cadência e sem variante própria do nicho', async () => {
    const banco = new BancoFalso({
      templates: [email(ALVO.id, ORG, 'follow_up_1'), email('varejo', ORG, 'follow_up_1', 'varejo')],
      leads: [
        lead(ORG, { id: 'l1' }),
        lead(ORG, { id: 'l2', estagio: 'aguardando_resposta', segmento: 'Hotel' }),
        lead(ORG, { id: 'l3', segmento: 'Varejo' }),
        lead(ORG, { id: 'l4', owner: 'n8n' }),
        lead(ORG, { id: 'l5', bounced: true }),
        lead(ORG, { id: 'l6', optout: true }),
        lead(ORG, { id: 'l7', perdido: true }),
        lead(ORG, { id: 'l8', estagio: 'novos_leads' }),
        lead(OUTRA, { id: 'l9' }),
      ],
    })
    expect(await buscarUsosImpeditivos(banco.cliente(), ORG, ALVO)).toEqual([{ tipo: 'motor_cadencia', quantidade: 2 }])
  })

  it('motor de cadência com template de nicho: só os leads daquele nicho', async () => {
    const banco = new BancoFalso({
      templates: [email(ALVO.id, ORG, 'follow_up_1', 'hotelaria')],
      leads: [lead(ORG, { id: 'l1', segmento: 'Hotel' }), lead(ORG, { id: 'l2' }), lead(ORG, { id: 'l3', segmento: 'Varejo' })],
    })
    expect(await buscarUsosImpeditivos(banco.cliente(), ORG, { ...ALVO, nicho: 'hotelaria' })).toEqual([
      { tipo: 'motor_cadencia', quantidade: 1 },
    ])
  })

  it('uso na outra organização nunca bloqueia, e toda consulta filtra a organização do template', async () => {
    const banco = new BancoFalso({
      templates: [email(ALVO.id, ORG, 'follow_up_1'), email('b', OUTRA, 'follow_up_1')],
      workflows: [{ id: 'wb', organizacao_id: OUTRA, nome: 'Da outra', status: 'publicado', versao_atual_id: 'vb' }],
      workflow_versoes: [{ id: 'vb', organizacao_id: OUTRA, numero: 1, definicao: definicao('follow_up_1') }],
      workflow_execucoes: [{ id: 'eb', organizacao_id: OUTRA, versao_id: 'vb', status: 'aguardando' }],
      campanhas: [{ id: 'cb', organizacao_id: OUTRA, nome: 'Da outra', status: 'ativa', workflow_id: 'wb', publico: {} }],
      leads: [lead(OUTRA, { id: 'lb' })],
    })
    expect(await buscarUsosImpeditivos(banco.cliente(), ORG, ALVO)).toEqual([])
    for (const op of banco.operacoes) {
      expect(op.filtros).toContainEqual({ op: 'eq', coluna: 'organizacao_id', valor: ORG })
    }
  })
})
