// Ambiente do motor de workflows: os efeitos colaterais REAIS que os blocos
// disparam, atrás de uma interface — para o executor ser testável com um
// ambiente falso (ver __tests__/executor.test.ts).
//
// A implementação real REAPROVEITA o motor de cadência (não reescreve): mesmo
// EmailProvider (GmailProvider gated por MODO_ENSAIO) e mesmo Store de
// interações/leads. Assim "enviar mensagem por template" e "lead respondeu"
// usam exatamente a infra que já roda em produção.
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { criarMotorReal } from '@/lib/engine/scheduler'
import { normalizarNicho, preencher } from '@/lib/engine/mensagem'
import type { Motor } from '@/lib/engine'

export interface AmbienteWorkflow {
  readonly organizacaoId: string
  // Em simulação (Fase 5), ações de saída não têm efeito real — só logam.
  readonly simular: boolean
  // Gatilho 'campo_data_vence': leads cujo `campo` (data) vence em até `dias`.
  selecionarLeadsComCampoVencendo(campo: string, dias: number): Promise<string[]>
  // Condição 'lead_respondeu': o lead já respondeu? (interação tipo='resposta',
  // gravada pelo detectarResposta do motor).
  leadRespondeu(leadId: string): Promise<boolean>
  // Condição genérica 'campo' (Fase 4.5): lê UM campo do lead (whitelist de
  // colunas reais da tabela `leads`). Devolve null se o lead/campo não existir.
  lerCampoLead(leadId: string, campo: string): Promise<unknown>
  // Ação 'enviar_email': monta pelo template e envia (gated por MODO_ENSAIO /
  // simular). Devolve o assunto para o log da execução.
  enviarEmailTemplate(leadId: string, templateTipo: string): Promise<{ enviado: boolean; assunto: string }>
  // Ação 'criar_tarefa'/'criar_tarefa_ligacao': registra a tarefa como interação
  // de sistema no lead.
  criarTarefa(leadId: string, titulo: string): Promise<void>
  // Ações 'atualizar_status'/'mover_pipeline'/'atribuir_responsavel' (Fase 4.5):
  // grava UM campo do lead (whitelist de ESCRITA). No-op em simulação.
  atualizarCampoLead(leadId: string, campo: string, valor: unknown): Promise<void>
}

// Colunas de data que um gatilho pode observar. Whitelist: o `campo` vem da
// definição do workflow (input do usuário) e NÃO pode virar nome de coluna livre.
const CAMPOS_DATA_PERMITIDOS = new Set(['proxima_acao_data', 'ultimo_contato', 'created_at'])

// Colunas REAIS de `leads` (lib/supabase.ts, tipo Lead) que a condição genérica
// pode ler. Whitelist porque `campo` vem da definição do workflow (input do
// usuário) e NÃO pode virar nome de coluna livre. Nota: são as colunas de
// `leads`, não os campos do tipo `Empresa` (esse é o modelo de mock-data/UI).
const CAMPOS_LEAD_PERMITIDOS = new Set([
  'estagio', 'segmento', 'score', 'responsavel_nome', 'responsavel_id',
  'cidade', 'estado', 'origem', 'faixa_funcionarios', 'canal_preferencial',
  'followups_enviados', 'perdido', 'ultimo_contato', 'proxima_acao_data', 'created_at',
])

// Colunas de `leads` que as AÇÕES podem gravar. Subconjunto do que faz sentido
// mutar por automação — nunca id/organizacao_id/timestamps de sistema.
const CAMPOS_LEAD_ESCRITA_PERMITIDOS = new Set([
  'estagio', 'perdido', 'perdido_motivo', 'responsavel_id', 'responsavel_nome',
  'proxima_acao', 'proxima_acao_data',
])

export class AmbienteSupabase implements AmbienteWorkflow {
  private motor: Motor
  private db: SupabaseClient
  constructor(
    public readonly organizacaoId: string,
    opts: { simular?: boolean; client?: SupabaseClient } = {},
  ) {
    this.simular = opts.simular ?? false
    this.db = opts.client ?? createSupabaseAdminClient()
    // Motor real da org: Store (interações/leads/templates) + EmailProvider.
    this.motor = criarMotorReal(organizacaoId)
  }
  readonly simular: boolean

  async selecionarLeadsComCampoVencendo(campo: string, dias: number): Promise<string[]> {
    if (!CAMPOS_DATA_PERMITIDOS.has(campo)) throw new Error(`Campo de data não permitido no gatilho: '${campo}'`)
    const limite = new Date(Date.now() + dias * 86_400_000).toISOString()
    const { data, error } = await this.db
      .from('leads')
      .select('id')
      .eq('organizacao_id', this.organizacaoId)
      .not(campo, 'is', null)
      .lte(campo, limite)
    if (error) throw error
    return (data ?? []).map((l) => l.id as string)
  }

  async leadRespondeu(leadId: string): Promise<boolean> {
    return (await this.motor.store.contarInteracoes(leadId, 'resposta')) > 0
  }

  async lerCampoLead(leadId: string, campo: string): Promise<unknown> {
    if (!CAMPOS_LEAD_PERMITIDOS.has(campo))
      throw new Error(`Campo de lead não permitido na condição: '${campo}'`)
    // Lê só a coluna pedida, org-scoped (mesmo padrão de selecionarLeads...).
    const { data, error } = await this.db
      .from('leads')
      .select(campo)
      .eq('organizacao_id', this.organizacaoId)
      .eq('id', leadId)
      .maybeSingle()
    if (error) throw error
    // `select(campo)` dinâmico não é estaticamente tipado — cast via unknown.
    return data ? (data as unknown as Record<string, unknown>)[campo] ?? null : null
  }

  async enviarEmailTemplate(leadId: string, templateTipo: string): Promise<{ enviado: boolean; assunto: string }> {
    const lead = await this.motor.store.buscarLead(leadId)
    if (!lead) throw new Error(`lead ${leadId} não encontrado`)
    const nicho = normalizarNicho(lead.segmento)
    const tpl =
      (nicho ? await this.motor.store.buscarTemplateEmail(nicho, templateTipo) : null) ??
      (await this.motor.store.buscarTemplateEmail(null, templateTipo))
    if (!tpl) throw new Error(`Template ausente (tipo=${templateTipo}, nicho=${nicho ?? 'generico'}).`)
    const assunto = preencher(tpl.assunto ?? '{empresa}', lead)
    const corpo = preencher(tpl.corpo, lead)

    // Simulação (Fase 5): não envia nem grava — quem loga é o executor.
    if (this.simular) return { enviado: false, assunto }

    // Envio real (o GmailProvider ainda respeita MODO_ENSAIO por dentro).
    await this.motor.email.enviar(lead.contato_email, assunto, corpo)
    await this.motor.store.registrarInteracao({
      lead_id: leadId,
      tipo: 'nota',
      canal: 'email',
      descricao: `**${assunto}**\n\n${corpo}`,
      origem_acao: 'ia',
      responsavel_id: lead.responsavel_id ?? null,
    })
    return { enviado: true, assunto }
  }

  async criarTarefa(leadId: string, titulo: string): Promise<void> {
    if (this.simular) return
    await this.motor.store.registrarInteracao({
      lead_id: leadId,
      tipo: 'nota',
      canal: 'sistema',
      descricao: `Tarefa (workflow): ${titulo}`,
      origem_acao: 'ia',
    })
  }

  async atualizarCampoLead(leadId: string, campo: string, valor: unknown): Promise<void> {
    if (!CAMPOS_LEAD_ESCRITA_PERMITIDOS.has(campo))
      throw new Error(`Campo de lead não permitido para escrita: '${campo}'`)
    if (this.simular) return // em simulação não muta o lead
    const { error } = await this.db
      .from('leads')
      .update({ [campo]: valor })
      .eq('organizacao_id', this.organizacaoId)
      .eq('id', leadId)
    if (error) throw error
  }
}
