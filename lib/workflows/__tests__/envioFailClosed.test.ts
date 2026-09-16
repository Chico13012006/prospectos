// Envio fail-closed do bloco `enviar_email`: qualquer inconsistência de tenant
// ou de template impede o envio ANTES do provider, e nenhuma interação de envio
// é gravada. Também cobre o HTML do template (workflow sem campanha) e a trava
// de dry_run. Sem rede: client Supabase falso + motor falso.
import { describe, expect, it, vi } from 'vitest'
import { BancoFalso, type Linha } from '@/lib/templates/__tests__/bancoFalso'
import { AmbienteSupabase } from '../ambiente'
import type { Motor } from '@/lib/engine'
import type { TemplateEmail } from '@/lib/engine/store/store'

const ORG = 'aaaaaaaa-0000-4000-8000-000000000001'
const OUTRA = 'bbbbbbbb-0000-4000-8000-000000000002'
const LEAD = 'aaaaaaaa-5555-4555-8555-000000000001'
const CAMPANHA = 'aaaaaaaa-4444-4444-8444-000000000001'
const CAMPANHA_OUTRA = 'bbbbbbbb-4444-4444-8444-000000000001'

const lead = {
  id: LEAD,
  empresa: 'Empresa Exemplo',
  contato_nome: 'Maria Souza',
  contato_email: 'maria@exemplo.com.br',
  segmento: null,
  cidade: null,
  responsavel_id: null,
  responsavel_nome: 'Aline',
  data_validade: null,
}

function motorFalso(templates: TemplateEmail[]) {
  const enviados: { para: string; assunto: string; corpo: string; html?: string }[] = []
  const interacoes: Record<string, unknown>[] = []
  const email = {
    async enviar(para: string, assunto: string, corpo: string, html?: string) {
      enviados.push({ para, assunto, corpo, html })
    },
  }
  const motor = {
    email,
    emailProspeccao: email,
    store: {
      organizacaoId: ORG,
      async buscarLead() { return lead },
      async buscarTemplateEmail(nicho: string | null) { return nicho === null ? templates : [] },
      async buscarUsuario() { return null },
      // Envio de campanha leva o responsável em cópia — sem ele o envio é
      // bloqueado por regra própria, anterior a esta fase.
      async buscarContextoCampanhaAtiva() {
        return { nome: 'Campanha A', tipo: 'prospeccao', responsavel: { id: 'u1', nome: 'Aline', email: 'aline@org.com.br' } }
      },
      async registrarInteracao(interacao: Record<string, unknown>) { interacoes.push(interacao) },
      async reivindicarMensagem() { return true },
      async liberarMensagem() { /* nada */ },
    },
  } as unknown as Motor
  return { motor, enviados, interacoes }
}

const template = (dados: Partial<TemplateEmail> = {}): TemplateEmail => ({
  id: 'tpl-1',
  assunto: 'Validade de {{empresa}}',
  corpo: 'Olá {{nome}}',
  html: null,
  organizacao_id: ORG,
  ...dados,
})

function banco(campanhas: Linha[] = []) {
  return new BancoFalso({
    organizacoes: [{ id: ORG, nome: 'Org A', configuracoes: {} }, { id: OUTRA, nome: 'Org B', configuracoes: {} }],
    campanhas,
  })
}

// O gate de MODO_ENSAIO vem antes; aqui testamos o que acontece DEPOIS dele.
async function comEnvioReal<T>(fn: () => Promise<T>): Promise<T> {
  const anterior = process.env.MODO_ENSAIO
  process.env.MODO_ENSAIO = 'false'
  try {
    return await fn()
  } finally {
    process.env.MODO_ENSAIO = anterior
  }
}

describe('envio fail-closed — campanha', () => {
  it('campanha de outra organização: não envia, não grava interação', async () => {
    const { motor, enviados, interacoes } = motorFalso([template()])
    const db = banco([{ id: CAMPANHA_OUTRA, organizacao_id: OUTRA, dry_run: false, publico: {}, tipo: 'prospeccao' }])
    const ambiente = new AmbienteSupabase(ORG, { client: db.cliente(), motor })
    await comEnvioReal(async () => {
      await expect(ambiente.enviarEmailTemplate(LEAD, 'follow_up_1', CAMPANHA_OUTRA))
        .rejects.toThrow(/não pertence a esta organização/)
    })
    expect(enviados).toEqual([])
    expect(interacoes).toEqual([])
  })

  it('campanha inexistente no tenant: não envia', async () => {
    const { motor, enviados, interacoes } = motorFalso([template()])
    const ambiente = new AmbienteSupabase(ORG, { client: banco().cliente(), motor })
    await comEnvioReal(async () => {
      await expect(ambiente.enviarEmailTemplate(LEAD, 'follow_up_1', CAMPANHA)).rejects.toThrow(/Envio bloqueado/)
    })
    expect(enviados).toEqual([])
    expect(interacoes).toEqual([])
  })

  it('campanha em dry_run: provider não é chamado e nada é gravado', async () => {
    const { motor, enviados, interacoes } = motorFalso([template()])
    const db = banco([{ id: CAMPANHA, organizacao_id: ORG, dry_run: true, publico: {}, tipo: 'prospeccao' }])
    const ambiente = new AmbienteSupabase(ORG, { client: db.cliente(), motor })
    const r = await comEnvioReal(() => ambiente.enviarEmailTemplate(LEAD, 'follow_up_1', CAMPANHA))
    expect(r.enviado).toBe(false)
    expect(enviados).toEqual([])
    expect(interacoes).toEqual([])
  })
})

describe('envio fail-closed — template', () => {
  it('template ausente na organização: não envia', async () => {
    const { motor, enviados, interacoes } = motorFalso([])
    const ambiente = new AmbienteSupabase(ORG, { client: banco().cliente(), motor })
    await comEnvioReal(async () => {
      await expect(ambiente.enviarEmailTemplate(LEAD, 'follow_up_1')).rejects.toThrow(/Template ausente/)
    })
    expect(enviados).toEqual([])
    expect(interacoes).toEqual([])
  })

  it('template de outra organização: não envia', async () => {
    const { motor, enviados, interacoes } = motorFalso([template({ organizacao_id: OUTRA })])
    const ambiente = new AmbienteSupabase(ORG, { client: banco().cliente(), motor })
    await comEnvioReal(async () => {
      await expect(ambiente.enviarEmailTemplate(LEAD, 'follow_up_1')).rejects.toThrow(/não pertence a esta organização/)
    })
    expect(enviados).toEqual([])
    expect(interacoes).toEqual([])
  })
})

describe('envio com HTML do template (workflow sem campanha)', () => {
  it('usa o HTML do template, preenchido e sanitizado, com texto alternativo', async () => {
    const { motor, enviados, interacoes } = motorFalso([
      template({ html: '<p>Renovação da <strong>{{empresa}}</strong></p><script>alert(1)</script>' }),
    ])
    const ambiente = new AmbienteSupabase(ORG, { client: banco().cliente(), motor })
    const r = await comEnvioReal(() => ambiente.enviarEmailTemplate(LEAD, 'renovacao_1'))

    expect(r.enviado).toBe(true)
    expect(enviados).toHaveLength(1)
    expect(enviados[0].assunto).toBe('Validade de Empresa Exemplo')
    expect(enviados[0].corpo).toBe('Olá Maria')
    expect(enviados[0].html).toContain('<p>Renovação da <strong>Empresa Exemplo</strong></p>')
    expect(enviados[0].html).not.toContain('<script')
    expect(interacoes[0]).toMatchObject({ lead_id: LEAD, canal: 'email', template_id: 'tpl-1' })
  })

  it('template de texto continua enviando o texto embrulhado (sem HTML próprio)', async () => {
    const { motor, enviados } = motorFalso([template()])
    const ambiente = new AmbienteSupabase(ORG, { client: banco().cliente(), motor })
    await comEnvioReal(() => ambiente.enviarEmailTemplate(LEAD, 'follow_up_1'))
    expect(enviados[0].html).toContain('Olá Maria')
    expect(enviados[0].corpo).toBe('Olá Maria')
  })

  it('HTML da campanha tem precedência sobre o do template', async () => {
    const { motor, enviados } = motorFalso([template({ html: '<p>Do template</p>' })])
    const db = banco([{
      id: CAMPANHA,
      organizacao_id: ORG,
      dry_run: false,
      tipo: 'prospeccao',
      publico: { operacao: { mensagemInicial: { templateTipo: 'follow_up_1', html: '<p>Da campanha para {{empresa}}</p>' } } },
    }])
    const ambiente = new AmbienteSupabase(ORG, { client: db.cliente(), motor })
    await comEnvioReal(() => ambiente.enviarEmailTemplate(LEAD, 'follow_up_1', CAMPANHA))
    expect(enviados[0].html).toContain('Da campanha para Empresa Exemplo')
    expect(enviados[0].html).not.toContain('Do template')
  })
})

describe('simulação e ensaio continuam valendo', () => {
  it('em simulação nada é enviado nem gravado', async () => {
    const { motor, enviados, interacoes } = motorFalso([template()])
    const ambiente = new AmbienteSupabase(ORG, { client: banco().cliente(), motor, simular: true })
    const r = await ambiente.enviarEmailTemplate(LEAD, 'follow_up_1', CAMPANHA)
    expect(r.enviado).toBe(false)
    expect(enviados).toEqual([])
    expect(interacoes).toEqual([])
  })

  it('MODO_ENSAIO bloqueia antes de qualquer envio', async () => {
    const { motor, enviados } = motorFalso([template()])
    const ambiente = new AmbienteSupabase(ORG, { client: banco().cliente(), motor })
    const anterior = process.env.MODO_ENSAIO
    process.env.MODO_ENSAIO = 'true'
    await expect(ambiente.enviarEmailTemplate(LEAD, 'follow_up_1')).rejects.toThrow(/MODO_ENSAIO/)
    process.env.MODO_ENSAIO = anterior
    expect(enviados).toEqual([])
  })
})
