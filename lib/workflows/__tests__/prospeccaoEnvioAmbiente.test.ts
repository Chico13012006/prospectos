// Prova o efeito de PROSPECÇÃO em AmbienteSupabase.enviarEmailTemplate (itens
// 2, 3 e 5 da entrega "Prospecção + Follow-up") e, com o mesmo mecanismo,
// prova a REGRESSÃO OBRIGATÓRIA de Renovação/Laudos: para campanhaTipo
// diferente de 'prospeccao', nada do que foi adicionado nesta entrega roda —
// nem o gate de opt-out/bounce/perdido, nem a mudança de estágio, nem o tipo
// de interação (continua 'nota').
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BancoFalso, type Linha } from '@/lib/templates/__tests__/bancoFalso'
import { AmbienteSupabase } from '../ambiente'
import type { Motor } from '@/lib/engine'
import type { TemplateEmail } from '@/lib/engine/store/store'

// Remetente DEDICADO (nomenclaturas.email_conta_key) é exigido pela trava de
// prospecção (lib/workflows/ambiente.ts) sempre que campanhaId + tipo=
// 'prospeccao'. Os testes de envio bem-sucedido de prospecção passam essa
// chave na org; para não abrir uma conexão SMTP real, GmailProvider é
// mockado aqui (só quando a chave usada é esta — os demais testes deste
// arquivo continuam usando o motor falso via `this.motor.email`).
const { CONTA_TESTE, enviosGmailMock } = vi.hoisted(() => ({
  CONTA_TESTE: 'PROSPECCAOENVIO_TESTE',
  enviosGmailMock: [] as { para: string; assunto: string; corpo: string; html?: string; cc?: string[] }[],
}))
vi.mock('@/lib/engine/email/gmailProvider', () => ({
  lerCredenciaisGmail: (papel?: string) =>
    (papel === CONTA_TESTE ? { user: 'prospeccao@org-a.test', appPassword: 'segredo-teste' } : null),
  GmailProvider: class {
    async enviar(para: string, assunto: string, corpo: string, html?: string, cc?: string[]) {
      enviosGmailMock.push({ para, assunto, corpo, html, cc })
    }
  },
}))
beforeEach(() => { enviosGmailMock.length = 0 })

const ORG = 'aaaaaaaa-0000-4000-8000-000000000001'
const LEAD = 'aaaaaaaa-5555-4555-8555-000000000001'
const CAMPANHA = 'aaaaaaaa-4444-4444-8444-000000000001'

// Estrutural, não `Pick<Lead, ...>`: o tipo `Lead` não declara `optout` (gap
// pré-existente, ver lib/campanhas/prospeccaoEnvio.ts) e este fixture de teste
// precisa dele para exercitar o gate de bloqueio.
interface LeadFalso {
  id: string
  empresa: string | null
  contato_nome: string | null
  contato_email: string
  segmento: string | null
  cidade: string | null
  responsavel_id: string | null
  responsavel_nome: string | null
  data_validade: string | null
  estagio: string
  followups_enviados: number
  optout: boolean
  bounced: boolean
  perdido: boolean
}

function leadBase(overrides: Partial<LeadFalso> = {}): LeadFalso {
  return {
    id: LEAD,
    empresa: 'Empresa Exemplo',
    contato_nome: 'Maria Souza',
    contato_email: 'maria@exemplo.com.br',
    segmento: null,
    cidade: null,
    responsavel_id: null,
    responsavel_nome: 'Aline',
    data_validade: null,
    estagio: 'novos_leads',
    followups_enviados: 0,
    optout: false,
    bounced: false,
    perdido: false,
    ...overrides,
  }
}

function motorFalso(lead: LeadFalso, templates: TemplateEmail[]) {
  const enviados: { para: string; assunto: string }[] = []
  const interacoes: Record<string, unknown>[] = []
  const atualizacoesLead: { id: string; patch: Record<string, unknown> }[] = []
  const email = { async enviar(para: string, assunto: string) { enviados.push({ para, assunto }) } }
  const motor = {
    email,
    emailProspeccao: email,
    store: {
      organizacaoId: ORG,
      async buscarLead() { return lead },
      async buscarTemplateEmail(nicho: string | null) { return nicho === null ? templates : [] },
      async buscarUsuario() { return null },
      // Envio de campanha exige CC com e-mail (lib/campanhas/emailComCopiaServidor.ts
      // lança sem isto) — mesmo fixture usado em envioFailClosed.test.ts.
      async buscarContextoCampanhaAtiva() {
        return { nome: 'Campanha A', tipo: 'prospeccao', responsavel: { id: 'u1', nome: 'Aline', email: 'aline@org.com.br' } }
      },
      async registrarInteracao(interacao: Record<string, unknown>) { interacoes.push(interacao) },
      async reivindicarMensagem() { return true },
      async liberarMensagem() { /* nada */ },
      async atualizarLead(id: string, patch: Record<string, unknown>) { atualizacoesLead.push({ id, patch }) },
    },
  } as unknown as Motor
  return { motor, enviados, interacoes, atualizacoesLead }
}

const template = (dados: Partial<TemplateEmail> = {}): TemplateEmail => ({
  id: 'tpl-1',
  assunto: 'Contato — {{empresa}}',
  corpo: 'Olá {{nome}}',
  html: null,
  organizacao_id: ORG,
  ...dados,
})

function banco(campanha: Linha, orgConfiguracoes: Record<string, unknown> = {}) {
  return new BancoFalso({
    organizacoes: [{ id: ORG, nome: 'Org A', configuracoes: orgConfiguracoes }],
    campanhas: [{ id: CAMPANHA, organizacao_id: ORG, dry_run: false, publico: {}, ...campanha }],
  })
}

// Org COM remetente dedicado — só para os testes de envio real de prospecção
// (ver comentário do mock de GmailProvider acima).
const configComRemetente = { nomenclaturas: { email_conta_key: CONTA_TESTE } }

async function comEnvioReal<T>(fn: () => Promise<T>): Promise<T> {
  const anterior = process.env.MODO_ENSAIO
  process.env.MODO_ENSAIO = 'false'
  try { return await fn() } finally { process.env.MODO_ENSAIO = anterior }
}

describe('prospecção — efeito do envio sobre o lead', () => {
  it('1º contato: registra abordagem e move novos_leads -> primeiro_contato', async () => {
    const lead = leadBase({ estagio: 'novos_leads', followups_enviados: 0 })
    const { motor, interacoes, atualizacoesLead } = motorFalso(lead, [template()])
    const ambiente = new AmbienteSupabase(ORG, { client: banco({ tipo: 'prospeccao' }, configComRemetente).cliente(), motor })

    const r = await comEnvioReal(() => ambiente.enviarEmailTemplate(LEAD, 'abordagem_1', CAMPANHA))

    expect(r.enviado).toBe(true)
    expect(enviosGmailMock).toHaveLength(1)
    expect(interacoes[0]).toMatchObject({ tipo: 'abordagem' })
    expect(atualizacoesLead).toEqual([{ id: LEAD, patch: { estagio: 'primeiro_contato', followups_enviados: 0 } }])
  })

  it('follow-up: registra follow_up, mantém estagio=follow_up e incrementa o cache', async () => {
    const lead = leadBase({ estagio: 'primeiro_contato', followups_enviados: 0 })
    const { motor, interacoes, atualizacoesLead } = motorFalso(lead, [template()])
    const ambiente = new AmbienteSupabase(ORG, { client: banco({ tipo: 'prospeccao' }, configComRemetente).cliente(), motor })

    const r = await comEnvioReal(() => ambiente.enviarEmailTemplate(LEAD, 'follow_up_1', CAMPANHA))

    expect(r.enviado).toBe(true)
    expect(enviosGmailMock).toHaveLength(1)
    expect(interacoes[0]).toMatchObject({ tipo: 'follow_up' })
    expect(atualizacoesLead).toEqual([{ id: LEAD, patch: { estagio: 'follow_up', followups_enviados: 1 } }])
  })

  it('follow-ups seguintes continuam incrementando o cache a cada envio', async () => {
    const lead = leadBase({ estagio: 'follow_up', followups_enviados: 2 })
    const { motor, atualizacoesLead } = motorFalso(lead, [template()])
    const ambiente = new AmbienteSupabase(ORG, { client: banco({ tipo: 'prospeccao' }, configComRemetente).cliente(), motor })

    await comEnvioReal(() => ambiente.enviarEmailTemplate(LEAD, 'follow_up_3', CAMPANHA))

    expect(atualizacoesLead).toEqual([{ id: LEAD, patch: { estagio: 'follow_up', followups_enviados: 3 } }])
  })

  it('bloqueia envio real de prospecção quando a organização não tem remetente configurado (sem fallback silencioso)', async () => {
    const lead = leadBase({ estagio: 'novos_leads' })
    const { motor, interacoes, atualizacoesLead } = motorFalso(lead, [template()])
    // Org SEM email_conta_key (config padrão de `banco`, sem configComRemetente).
    const ambiente = new AmbienteSupabase(ORG, { client: banco({ tipo: 'prospeccao' }).cliente(), motor })

    await comEnvioReal(async () => {
      await expect(ambiente.enviarEmailTemplate(LEAD, 'abordagem_1', CAMPANHA))
        .rejects.toThrow('Configure um remetente em Configurações antes de iniciar a campanha.')
    })
    expect(enviosGmailMock).toEqual([])
    expect(interacoes).toEqual([])
    expect(atualizacoesLead).toEqual([])
  })

  it.each([
    ['optout', { optout: true }],
    ['bounced', { bounced: true }],
    ['perdido', { perdido: true }],
    ['descartado', { estagio: 'descartado' as const }],
  ])('bloqueia envio de prospecção quando o lead está %s', async (_nome, overrides) => {
    const lead = leadBase({ estagio: 'follow_up', ...overrides })
    const { motor, enviados, interacoes, atualizacoesLead } = motorFalso(lead, [template()])
    const ambiente = new AmbienteSupabase(ORG, { client: banco({ tipo: 'prospeccao' }).cliente(), motor })

    const r = await comEnvioReal(() => ambiente.enviarEmailTemplate(LEAD, 'follow_up_1', CAMPANHA))

    expect(r.enviado).toBe(false)
    expect(enviados).toEqual([])
    expect(interacoes).toEqual([])
    expect(atualizacoesLead).toEqual([])
  })
})

describe('renovação — regressão obrigatória (comportamento preservado)', () => {
  it('envio de renovação NÃO grava estágio/followups_enviados (continua sem tocar no lead)', async () => {
    const lead = leadBase({ estagio: 'renovacao', followups_enviados: 0 })
    const { motor, enviados, interacoes, atualizacoesLead } = motorFalso(lead, [template()])
    const ambiente = new AmbienteSupabase(ORG, { client: banco({ tipo: 'renovacao' }).cliente(), motor })

    const r = await comEnvioReal(() => ambiente.enviarEmailTemplate(LEAD, 'renovacao_1', CAMPANHA))

    expect(r.enviado).toBe(true)
    expect(enviados).toHaveLength(1)
    // Continua 'nota', como antes desta entrega — não vira 'abordagem'/'follow_up'.
    expect(interacoes[0]).toMatchObject({ tipo: 'nota' })
    // Nenhuma chamada nova a atualizarLead: renovação não ganhou o efeito de prospecção.
    expect(atualizacoesLead).toEqual([])
  })

  it('envio de renovação NÃO é bloqueado por optout/bounced/perdido (gate novo não se aplica — gap pré-existente preservado)', async () => {
    // Este teste documenta, de propósito, que o gate de segurança adicionado
    // nesta entrega é ESTRITO a campanhaTipo==='prospeccao'. Renovação segue
    // com o comportamento anterior a esta entrega, inclusive esta lacuna
    // conhecida (ver relatório da entrega) — corrigi-la é uma decisão à parte,
    // fora do escopo autorizado aqui.
    const lead = leadBase({ estagio: 'renovacao', optout: true, bounced: true, perdido: true })
    const { motor, enviados } = motorFalso(lead, [template()])
    const ambiente = new AmbienteSupabase(ORG, { client: banco({ tipo: 'renovacao' }).cliente(), motor })

    const r = await comEnvioReal(() => ambiente.enviarEmailTemplate(LEAD, 'renovacao_1', CAMPANHA))

    expect(r.enviado).toBe(true)
    expect(enviados).toHaveLength(1)
  })

  it('envio sem campanha (workflow avulso) continua gravando nota e não toca no lead', async () => {
    const lead = leadBase({ estagio: 'novos_leads' })
    const { motor, enviados, interacoes, atualizacoesLead } = motorFalso(lead, [template()])
    const ambiente = new AmbienteSupabase(ORG, { client: banco({ tipo: 'prospeccao' }).cliente(), motor })

    // Sem 3º argumento (campanhaId): o gate de prospecção não pode se aplicar,
    // mesmo que exista uma campanha 'prospeccao' cadastrada na organização.
    const r = await comEnvioReal(() => ambiente.enviarEmailTemplate(LEAD, 'abordagem_1'))

    expect(r.enviado).toBe(true)
    expect(enviados).toHaveLength(1)
    expect(interacoes[0]).toMatchObject({ tipo: 'nota' })
    expect(atualizacoesLead).toEqual([])
  })
})
