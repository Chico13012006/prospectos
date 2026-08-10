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
import { normalizarNicho, preencher, indiceVariante } from '@/lib/engine/mensagem'
import { log } from '@/lib/engine/logger'
import type { Motor } from '@/lib/engine'
import type { Lead } from '@/lib/engine/types'
import { avaliarOperador, type Operador } from './operadores'

export interface AmbienteWorkflow {
  readonly organizacaoId: string
  // Em simulação (Fase 5), ações de saída não têm efeito real — só logam.
  readonly simular: boolean
  // Gatilho 'campo_data_vence': leads cujo `campo` (data) vence em até `dias`.
  selecionarLeadsComCampoVencendo(campo: string, dias: number): Promise<string[]>
  // Gatilho 'campo_igual' (Fase 4.6): leads cujo `campo` satisfaz `operador` vs
  // `valor` (reaproveita avaliarOperador). Serve p/ "mudou de status" e "entrou
  // em etapa" (o enrollment idempotente dispara uma vez por lead/workflow).
  selecionarLeadsPorCampo(campo: string, operador: string, valor: unknown): Promise<string[]>
  // Gatilho 'sem_resposta_ha_dias' (Fase 4.6): leads que NUNCA tiveram interação
  // tipo='resposta' e cujo `campo` (data) é mais antigo que `dias` dias.
  selecionarLeadsSemRespostaHaDias(campo: string, dias: number): Promise<string[]>
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
  // de sistema no lead, com responsável. Sem responsavelId → cai no responsável
  // do próprio lead (lead.responsavel_id).
  criarTarefa(leadId: string, titulo: string, responsavelId?: string | null): Promise<void>
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

  async selecionarLeadsPorCampo(campo: string, operador: string, valor: unknown): Promise<string[]> {
    if (!CAMPOS_LEAD_PERMITIDOS.has(campo))
      throw new Error(`Campo de lead não permitido no gatilho: '${campo}'`)
    // Traz id + o campo e filtra em memória com avaliarOperador (mesma lógica da
    // condição — sem duplicar). Org pequena; ok não empurrar todo operador p/ o SQL.
    const { data, error } = await this.db
      .from('leads')
      .select(`id, ${campo}`)
      .eq('organizacao_id', this.organizacaoId)
    if (error) throw error
    // `select('id, ' + campo)` dinâmico não é estaticamente tipado — cast via unknown.
    const linhas = (data ?? []) as unknown as Record<string, unknown>[]
    return linhas
      .filter((l) => avaliarOperador(operador as Operador, l[campo], valor))
      .map((l) => l.id as string)
  }

  async selecionarLeadsSemRespostaHaDias(campo: string, dias: number): Promise<string[]> {
    if (!CAMPOS_DATA_PERMITIDOS.has(campo))
      throw new Error(`Campo de data não permitido no gatilho: '${campo}'`)
    const limite = new Date(Date.now() - dias * 86_400_000).toISOString()
    // Candidatos: campo (data) mais antigo que N dias.
    const { data: candidatos, error: e1 } = await this.db
      .from('leads')
      .select('id')
      .eq('organizacao_id', this.organizacaoId)
      .not(campo, 'is', null)
      .lte(campo, limite)
    if (e1) throw e1
    // Anti-join: quem já teve interação tipo='resposta' fica de fora.
    const { data: respostas, error: e2 } = await this.db
      .from('interacoes')
      .select('lead_id')
      .eq('organizacao_id', this.organizacaoId)
      .eq('tipo', 'resposta')
    if (e2) throw e2
    const responderam = new Set((respostas ?? []).map((r) => (r as { lead_id: string }).lead_id))
    return (candidatos ?? [])
      .map((l) => (l as { id: string }).id)
      .filter((id) => !responderam.has(id))
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
    // Variantes ativas (A/B, item 6) c/ fallback genérico; escolhe uma por lead.
    const varsNicho = nicho ? await this.motor.store.buscarTemplateEmail(nicho, templateTipo) : []
    const variantes = varsNicho.length ? varsNicho : await this.motor.store.buscarTemplateEmail(null, templateTipo)
    if (variantes.length === 0) throw new Error(`Template ausente (tipo=${templateTipo}, nicho=${nicho ?? 'generico'}).`)
    const tpl = variantes[indiceVariante(lead.id, variantes.length)]
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
      template_id: tpl.id, // A/B testing (item 6)
    })
    return { enviado: true, assunto }
  }

  async criarTarefa(leadId: string, titulo: string, responsavelId?: string | null): Promise<void> {
    if (this.simular) return
    // Buscamos o lead também para o fallback de responsável E para o corpo da
    // notificação (empresa/contato).
    const lead = await this.motor.store.buscarLead(leadId)
    // Responsável explícito da ação; senão, o responsável do próprio lead.
    const responsavel = responsavelId ?? lead?.responsavel_id ?? null

    // 1ª classe (Fase 4): a tarefa vira linha em `tarefas` (não mais só nota).
    const { data: tarefa } = await this.db.from('tarefas').insert({
      organizacao_id: this.organizacaoId,
      lead_id: leadId,
      tipo: 'workflow',
      titulo,
      responsavel_id: responsavel,
      origem: 'workflow',
      motivo: 'Ação de workflow: criar tarefa',
    }).select('id').single()

    // Histórico do lead (seção 9: tarefa aparece na conversa). Mantido além da
    // tabela `tarefas` — é o registro cronológico que o LeadPanel exibe.
    await this.motor.store.registrarInteracao({
      lead_id: leadId,
      tipo: 'nota',
      canal: 'sistema',
      descricao: `Tarefa: ${titulo}`,
      origem_acao: 'ia',
      responsavel_id: responsavel,
    })

    // Notificação (in-app + e-mail, best-effort): registra em `notificacoes` e
    // dispara o e-mail HTML. Falha aqui nunca propaga (a tarefa já está gravada).
    await this.notificarResponsavelTarefa(tarefa?.id ?? null, leadId, responsavel, titulo, lead)
  }

  // Avisa por e-mail o responsável de uma tarefa recém-criada — mesma infra da
  // notificação de closer (this.motor.email.enviar, gated por MODO_ENSAIO dentro
  // do GmailProvider). Best-effort: sem responsável/e-mail, ou falha na busca/envio,
  // não quebra a criação da tarefa — só loga.
  private async notificarResponsavelTarefa(
    tarefaId: string | null,
    leadId: string,
    responsavelId: string | null,
    titulo: string,
    lead: Lead | null,
  ): Promise<void> {
    if (!responsavelId) return
    try {
      const usuario = await this.motor.store.buscarUsuario(responsavelId)
      if (!usuario?.email) {
        log.aviso('Responsável da tarefa sem e-mail cadastrado — sem notificação.', {
          leadId,
          responsavelId,
        })
        return
      }
      const empresa = lead?.empresa ?? '(lead)'
      const contato = lead?.contato_nome ?? lead?.contato_email ?? '-'
      // Registro estruturado da notificação (Fase 4) — canal e-mail.
      await this.db.from('notificacoes').insert({
        organizacao_id: this.organizacaoId,
        email: usuario.email,
        canal: 'email',
        titulo: `Nova tarefa: ${titulo}`,
        mensagem: `Você é responsável pela tarefa "${titulo}" (${empresa}).`,
        lead_id: leadId,
        tarefa_id: tarefaId,
        origem: 'workflow',
        motivo: 'Tarefa criada por workflow',
        link: `/leads/${leadId}`,
      })
      // Texto puro = fallback (clientes sem HTML). Mantém o formato de antes.
      const corpo = [
        'Você foi definido como responsável por uma nova tarefa gerada por um workflow.',
        '',
        `Tarefa  : ${titulo}`,
        `Empresa : ${empresa}`,
        `Contato : ${contato}`,
      ].join('\n')
      const html = montarEmailTarefaHtml({ nome: usuario.nome, titulo, empresa, contato, leadId })
      await this.motor.email.enviar(usuario.email, `Nova tarefa: ${titulo}`, corpo, html)
    } catch (e) {
      log.erro('Falha ao notificar responsável da tarefa (tarefa criada mesmo assim).', {
        leadId,
        responsavelId,
        erro: e instanceof Error ? e.message : String(e),
      })
    }
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

// Escapa texto do usuário para interpolar com segurança no HTML do e-mail.
function escaparHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// E-mail transacional (HTML) da notificação de tarefa. Regras de e-mail: layout
// por TABELAS + estilos INLINE (nada de flexbox/CSS externo), compatível com os
// clientes de e-mail. Acento verde (#22c55e, o mesmo do ícone da sidebar), fundo
// branco. O botão leva a /leads/{id}, que redireciona para o LeadPanel real.
function montarEmailTarefaHtml(dados: {
  nome: string
  titulo: string
  empresa: string
  contato: string
  leadId: string
}): string {
  const nome = escaparHtml(dados.nome)
  const titulo = escaparHtml(dados.titulo)
  const empresa = escaparHtml(dados.empresa)
  const contato = escaparHtml(dados.contato)
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? ''
  const leadUrl = escaparHtml(`${base}/leads/${dados.leadId}`)
  const VERDE = '#22c55e'
  const linha = (rotulo: string, valor: string) =>
    `<tr>
      <td style="padding:5px 0;color:#64748b;font-size:14px;width:96px;vertical-align:top;">${rotulo}</td>
      <td style="padding:5px 0;color:#0f172a;font-size:14px;font-weight:bold;">${valor}</td>
    </tr>`
  return `<!doctype html>
<html lang="pt-BR">
<body style="margin:0;padding:0;background-color:#f4f5f7;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background-color:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
        <tr>
          <td style="padding:20px 28px;border-bottom:1px solid #eef0f2;">
            <table role="presentation" cellpadding="0" cellspacing="0"><tr>
              <td width="32" style="width:32px;height:32px;background-color:${VERDE};border-radius:8px;text-align:center;vertical-align:middle;color:#ffffff;font-size:16px;font-weight:bold;line-height:32px;">&#9889;</td>
              <td style="padding-left:10px;vertical-align:middle;">
                <div style="font-size:15px;font-weight:bold;color:#0f172a;line-height:1.15;">ProspectOS</div>
                <div style="font-size:12px;color:#6366f1;line-height:1.15;">InovaCode</div>
              </td>
            </tr></table>
          </td>
        </tr>
        <tr>
          <td style="padding:28px;">
            <p style="margin:0 0 14px;font-size:16px;color:#0f172a;">Olá, ${nome},</p>
            <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#334155;">Você foi definido como responsável por uma nova tarefa gerada por um workflow.</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;">
              <tr><td style="padding:14px 18px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  ${linha('Tarefa', titulo)}
                  ${linha('Empresa', empresa)}
                  ${linha('Contato', contato)}
                </table>
              </td></tr>
            </table>
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 4px;"><tr>
              <td style="background-color:${VERDE};border-radius:8px;">
                <a href="${leadUrl}" target="_blank" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:bold;color:#ffffff;text-decoration:none;">Ver lead no ProspectOS</a>
              </td>
            </tr></table>
          </td>
        </tr>
        <tr>
          <td style="padding:18px 28px;border-top:1px solid #eef0f2;background-color:#fafafa;">
            <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.5;">Esta é uma mensagem automática do ProspectOS. Não responda a este e-mail.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}
