import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { montarEmailCampanhaHtml } from '@/lib/campanhas/emailCampanha'
import type { Lead } from '@/lib/engine/types'
import { COLUNAS, labelEstagio } from '@/lib/pipeline-stages'
import { telefoneParaEnvio } from '@/lib/whatsapp/outbound'
import {
  descreverReuniao,
  ehCanalMensagemEtapa,
  escolherTemplateEtapa,
  ESTAGIOS_DESTINO_KANBAN,
  exigeReuniao,
  materializarMensagemEtapa,
  validarReuniao,
  variaveisDaReuniao,
  type CanalMensagemEtapa,
  type DadosReuniao,
  type MensagemEtapa,
  type TemplateEtapa,
} from './mensagemEtapa'

// Kanban: mover o lead de etapa ("Apenas mover") ou mover e enviar a mensagem
// da etapa ("Mover e enviar"), por POST /api/leads/[id]/mover. A prévia do
// modal (POST /api/leads/[id]/mover/previa) passa pelo MESMO preparo, sem
// nenhum efeito.
//
// Ordem — nada externo acontece antes de todas as travas passarem:
//   1. lead lido na organização da SESSÃO (`db` é service_role: filtro
//      explícito); etapa de origem conferida com a que a tela viu
//   2. envio: travas do lead (opt-out, perdido, bounce no e-mail, destino),
//      template da etapa no canal escolhido e variáveis todas preenchidas
//   3. ensaio do canal (MODO_ENSAIO no e-mail, WHATSAPP_MODO_ENSAIO no
//      WhatsApp): para aqui — nada enviado, nada movido, nada gravado
//   4. troca de etapa CONDICIONAL à etapa lida (compare-and-set): um segundo
//      clique ou outra pessoa movendo ao mesmo tempo não passa daqui, então a
//      mensagem nunca sai duas vezes
//   5. envio; se falhar, a etapa volta à de origem e o erro é devolvido
//   6. histórico do lead
// Depois que o provedor aceitou, falha de registro NÃO vira erro: o usuário
// reenviaria em dobro (mesmo contrato do envio de proposta e da Central).
//
// Mover nunca recoloca o lead na cadência: o Kanban só tem etapas depois da
// resposta, e nada aqui toca owner, follow-ups ou campanhas.

export type CodigoErroMover =
  | 'etapa_invalida'
  | 'reuniao_invalida'
  | 'lead_nao_encontrado'
  | 'ja_na_etapa'
  | 'etapa_mudou'
  | 'canal_invalido'
  | 'optout'
  | 'perdido'
  | 'bounced'
  | 'sem_email'
  | 'sem_telefone'
  | 'sem_template'
  | 'variaveis_pendentes'
  | 'credencial_ausente'
  | 'config_ausente'
  | 'whatsapp_indisponivel'
  | 'falha_envio'

type Falha<C extends CodigoErroMover = CodigoErroMover> = { ok: false; codigo: C; mensagem: string }

export interface AtorMovimento {
  usuarioId: string | null
  nome: string | null
}

export interface EntradaMover {
  leadId: string
  organizacaoId: string
  de: unknown // etapa que a tela mostrava
  para: unknown // estágio de destino
  reuniao?: unknown
  canal?: unknown // ausente/null = "Apenas mover"
}

export interface DepsMoverLead {
  agora: () => Date
  modoEnsaio: (canal: CanalMensagemEtapa) => boolean
  enviarEmail: (e: {
    organizacaoId: string
    para: string
    assunto: string
    texto: string
    html: string
  }) => Promise<{ ok: true } | Falha<'credencial_ausente' | 'falha_envio'>>
  enviarWhatsapp: (e: {
    organizacaoId: string
    leadId: string
    texto: string
  }) => Promise<
    | { ok: true; registrada: boolean }
    | Falha<'lead_nao_encontrado' | 'sem_telefone' | 'config_ausente' | 'whatsapp_indisponivel' | 'falha_envio'>
  >
}

export interface PreviaEnvio {
  canal: CanalMensagemEtapa
  destino: string
  templateNome: string
  assunto: string | null
  texto: string
  // E-mail: o HTML final, montado como no envio (para a prévia em iframe).
  html: string | null
}

export type ResultadoPrevia =
  | { ok: true; modoEnsaio: boolean; envio: PreviaEnvio }
  | Falha

export type ResultadoMover =
  | { ok: true; simulado: true; canal: CanalMensagemEtapa; destino: string }
  | {
    ok: true
    simulado: false
    estagio: string
    enviado: null | { canal: CanalMensagemEtapa; destino: string }
    // false = a etapa mudou (e a mensagem saiu, se era o caso), mas algum
    // registro do histórico falhou. NÃO reenviar.
    registrada: boolean
  }
  | Falha

const falha = <C extends CodigoErroMover>(codigo: C, mensagem: string): Falha<C> => ({ ok: false, codigo, mensagem })

const textoErro = (e: unknown) => (e instanceof Error ? e.message : String(e))

// Log estruturado sem PII: nunca inclui e-mail, telefone nem o texto enviado.
function log(nivel: 'info' | 'erro', msg: string, extra: Record<string, unknown>) {
  const linha = JSON.stringify({ ts: new Date().toISOString(), nivel, escopo: 'pipeline.mover', msg, ...extra })
  if (nivel === 'erro') console.error(linha)
  else console.log(linha)
}

type LeadMover = Lead & {
  optout?: boolean | null
  bounced?: boolean | null
  perdido?: boolean | null
  contato_telefone?: string | null
  responsavel_id?: string | null
}

const colunaDoEstagio = (estagio: string | null | undefined) =>
  COLUNAS.find((c) => c.estagios.includes(estagio ?? ''))?.id ?? null

interface Preparo {
  lead: LeadMover
  para: string
  reuniao: DadosReuniao | null
  envio: null | {
    canal: CanalMensagemEtapa
    destino: string
    mensagem: MensagemEtapa
    htmlFinal: string | null
  }
}

async function preparar(db: SupabaseClient, entrada: EntradaMover): Promise<{ ok: true; preparo: Preparo } | Falha> {
  const org = entrada.organizacaoId
  const para = typeof entrada.para === 'string' ? entrada.para : ''
  if (!ESTAGIOS_DESTINO_KANBAN.includes(para)) return falha('etapa_invalida', 'Etapa de destino inválida.')

  let reuniao: DadosReuniao | null = null
  if (exigeReuniao(para)) {
    const v = validarReuniao(entrada.reuniao)
    if (!v.ok) return falha('reuniao_invalida', v.erro)
    reuniao = v.valor
  }

  const canalBruto = entrada.canal ?? null
  if (canalBruto !== null && !ehCanalMensagemEtapa(canalBruto)) return falha('canal_invalido', 'Escolha e-mail ou WhatsApp.')
  const canal = canalBruto as CanalMensagemEtapa | null

  // 1) ISOLAMENTO: o lead só existe para a organização da sessão.
  const { data: leadRow, error: erroLead } = await db
    .from('leads')
    .select('*')
    .eq('id', entrada.leadId)
    .eq('organizacao_id', org)
    .maybeSingle()
  if (erroLead) throw erroLead
  if (!leadRow) return falha('lead_nao_encontrado', 'Lead não encontrado nesta organização.')
  const lead = leadRow as LeadMover

  if (colunaDoEstagio(lead.estagio) === colunaDoEstagio(para)) {
    return falha('ja_na_etapa', `O lead já está em ${labelEstagio(para)}.`)
  }
  if (typeof entrada.de !== 'string' || lead.estagio !== entrada.de) {
    return falha('etapa_mudou', 'A etapa deste lead mudou enquanto você decidia. Atualize o quadro e tente de novo.')
  }

  if (!canal) return { ok: true, preparo: { lead, para, reuniao, envio: null } }

  // 2) Travas do lead — as mesmas do envio de proposta e da esteira do motor.
  if (lead.optout) return falha('optout', 'Este lead pediu para não receber contatos (opt-out).')
  if (lead.perdido) return falha('perdido', 'Lead marcado como perdido. Reative-o antes de enviar.')
  let destino: string
  if (canal === 'email') {
    if (lead.bounced) return falha('bounced', 'O e-mail deste lead devolveu (bounce). Corrija o endereço antes de enviar.')
    destino = lead.contato_email?.trim() ?? ''
    if (!destino) return falha('sem_email', 'O lead não tem e-mail cadastrado.')
  } else {
    destino = telefoneParaEnvio(lead.contato_telefone) ?? ''
    if (!destino) return falha('sem_telefone', 'O lead não tem telefone em formato utilizável para WhatsApp.')
  }

  const { data: tplRows, error: erroTpl } = await db
    .from('templates')
    .select('id, nome, nicho, assunto, corpo, html, created_at')
    .eq('organizacao_id', org)
    .eq('canal', canal)
    .eq('tipo', para)
    .eq('ativo', true)
  if (erroTpl) throw erroTpl
  const template = escolherTemplateEtapa((tplRows ?? []) as TemplateEtapa[], lead)
  if (!template) {
    const nomeCanal = canal === 'email' ? 'e-mail' : 'WhatsApp'
    return falha(
      'sem_template',
      `Nenhum template ativo de ${nomeCanal} para ${labelEstagio(para)}. Crie um em Comercial > Templates com a chave "${para}".`,
    )
  }

  // Variáveis: nome do serviço (nomenclaturas) e responsável, como no envio real.
  const [{ data: orgRow }, responsavel] = await Promise.all([
    db.from('organizacoes').select('nome, configuracoes').eq('id', org).maybeSingle(),
    lead.responsavel_id
      ? db.from('usuarios').select('nome').eq('id', lead.responsavel_id).eq('organizacao_id', org).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  const orgDados = orgRow as { nome?: string; configuracoes?: Record<string, unknown> } | null
  const nomenclaturas = orgDados?.configuracoes?.['nomenclaturas'] as Record<string, string> | undefined
  const nomeServico = nomenclaturas?.['nome_servico'] ?? orgDados?.nome ?? ''
  const responsavelNome = (responsavel.data as { nome?: string | null } | null)?.nome ?? null
  const leadComResponsavel = (responsavelNome
    ? { ...lead, usuarios: { ...(lead.usuarios ?? {}), nome: responsavelNome } }
    : lead) as Lead

  const extras: Record<string, string> = {
    ...(nomeServico ? { nome_servico: nomeServico } : {}),
    ...(reuniao ? variaveisDaReuniao(reuniao) : {}),
  }
  const mensagem = materializarMensagemEtapa(template, canal, leadComResponsavel, extras)
  if (mensagem.pendentes.length > 0) {
    return falha(
      'variaveis_pendentes',
      `O template "${template.nome}" usa ${mensagem.pendentes.map((v) => `{{${v}}}`).join(', ')}, que não dá para preencher com os dados deste lead. Ajuste o template ou o cadastro do lead.`,
    )
  }
  const htmlFinal = canal === 'email'
    ? montarEmailCampanhaHtml(mensagem.texto, { responsavelNome, nomeServico }, mensagem.html)
    : null

  return { ok: true, preparo: { lead, para, reuniao, envio: { canal, destino, mensagem, htmlFinal } } }
}

// Prévia do modal: mesmo preparo, zero efeito (não envia, não move, não grava).
export async function previaMover(
  db: SupabaseClient,
  entrada: EntradaMover,
  deps: Pick<DepsMoverLead, 'modoEnsaio'>,
): Promise<ResultadoPrevia> {
  if (!ehCanalMensagemEtapa(entrada.canal)) return falha('canal_invalido', 'Escolha e-mail ou WhatsApp.')
  const p = await preparar(db, entrada)
  if (!p.ok) return p
  const envio = p.preparo.envio!
  return {
    ok: true,
    modoEnsaio: deps.modoEnsaio(envio.canal),
    envio: {
      canal: envio.canal,
      destino: envio.destino,
      templateNome: envio.mensagem.templateNome,
      assunto: envio.mensagem.assunto,
      texto: envio.mensagem.texto,
      html: envio.htmlFinal,
    },
  }
}

export async function moverLead(
  db: SupabaseClient,
  entrada: EntradaMover,
  ator: AtorMovimento,
  deps: DepsMoverLead,
): Promise<ResultadoMover> {
  const p = await preparar(db, entrada)
  if (!p.ok) return p
  const { lead, para, reuniao, envio } = p.preparo
  const org = entrada.organizacaoId
  const de = lead.estagio

  // 3) Ensaio do canal: simulação sem nenhum efeito persistente.
  if (envio && deps.modoEnsaio(envio.canal)) {
    log('info', 'Ensaio: mover e enviar simulado; nada enviado, movido ou gravado.', {
      leadId: lead.id, organizacaoId: org, canal: envio.canal, para,
    })
    return { ok: true, simulado: true, canal: envio.canal, destino: envio.destino }
  }

  // 4) Troca de etapa condicional à etapa lida.
  const { data: movidas, error: erroMover } = await db
    .from('leads')
    .update({ estagio: para })
    .eq('id', lead.id)
    .eq('organizacao_id', org)
    .eq('estagio', de)
    .select('id')
  if (erroMover) throw erroMover
  if (!movidas || movidas.length === 0) {
    return falha('etapa_mudou', 'A etapa deste lead mudou enquanto você decidia. Atualize o quadro e tente de novo.')
  }

  // 5) Envio. Falhou: a etapa volta (só se ninguém a mudou de novo).
  let enviado: null | { canal: CanalMensagemEtapa; destino: string } = null
  let registrada = true
  if (envio) {
    let r: Awaited<ReturnType<DepsMoverLead['enviarEmail']>> | Awaited<ReturnType<DepsMoverLead['enviarWhatsapp']>>
    try {
      r = envio.canal === 'email'
        ? await deps.enviarEmail({
          organizacaoId: org,
          para: envio.destino,
          assunto: envio.mensagem.assunto ?? '',
          texto: envio.mensagem.texto,
          html: envio.htmlFinal ?? '',
        })
        : await deps.enviarWhatsapp({ organizacaoId: org, leadId: lead.id, texto: envio.mensagem.texto })
    } catch (e) {
      r = { ok: false, codigo: 'falha_envio', mensagem: `Falha ao enviar: ${textoErro(e)}` }
    }
    if (!r.ok) {
      const { error: erroVoltar } = await db
        .from('leads')
        .update({ estagio: de })
        .eq('id', lead.id)
        .eq('organizacao_id', org)
        .eq('estagio', para)
      if (erroVoltar) {
        log('erro', 'Envio falhou e a etapa não voltou à de origem.', { leadId: lead.id, erro: erroVoltar.message })
      }
      return falha(r.codigo, r.mensagem)
    }
    enviado = { canal: envio.canal, destino: envio.destino }
    if ('registrada' in r && !r.registrada) registrada = false
  }

  // 6) Histórico. Entrar em Reunião Agendada é uma interação `reuniao` (conta
  // nas reuniões do Dashboard e da Inteligência); as demais, uma nota.
  const agora = deps.agora().toISOString()
  const linhas = [
    `Movido de ${labelEstagio(de)} para ${labelEstagio(para)}${ator.nome ? ` por ${ator.nome}` : ''} (Kanban).`,
  ]
  if (reuniao) linhas.push(`Reunião agendada para ${descreverReuniao(reuniao)}.`)
  if (envio) {
    linhas.push(`Mensagem da etapa enviada por ${envio.canal === 'email' ? 'e-mail' : 'WhatsApp'} (template "${envio.mensagem.templateNome}").`)
  }
  const responsavelId = ator.usuarioId ?? lead.responsavel_id ?? null
  const registros: Record<string, unknown>[] = [{
    organizacao_id: org,
    lead_id: lead.id,
    tipo: reuniao ? 'reuniao' : 'nota',
    canal: 'plataforma',
    descricao: linhas.join('\n'),
    origem_acao: 'humano',
    responsavel_id: responsavelId,
    motivo: 'kanban_mover',
  }]
  // O e-mail entra também como a Central registra (nota/email): aparece na
  // Conversa. O WhatsApp já ficou em whatsapp_mensagens.
  if (envio?.canal === 'email') {
    registros.push({
      organizacao_id: org,
      lead_id: lead.id,
      tipo: 'nota',
      canal: 'email',
      descricao: `**${envio.mensagem.assunto ?? ''}**\n\n${envio.mensagem.texto}`,
      origem_acao: 'humano',
      responsavel_id: responsavelId,
      template_id: envio.mensagem.templateId,
    })
  }
  const { error: erroHistorico } = await db.from('interacoes').insert(registros)
  if (erroHistorico) {
    registrada = false
    log('erro', 'Lead movido, mas o histórico não foi registrado.', { leadId: lead.id, erro: erroHistorico.message })
  }
  if (enviado) {
    const { error: erroContato } = await db
      .from('leads')
      .update({ ultimo_contato: agora })
      .eq('id', lead.id)
      .eq('organizacao_id', org)
    if (erroContato) log('erro', 'Mensagem enviada, mas o último contato não foi atualizado.', { leadId: lead.id, erro: erroContato.message })
  }

  log('info', 'Lead movido no Kanban.', { leadId: lead.id, organizacaoId: org, de, para, canal: envio?.canal ?? null, registrada })
  return { ok: true, simulado: false, estagio: para, enviado, registrada }
}
