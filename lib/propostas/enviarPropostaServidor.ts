import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { nomeArquivoProposta, type PropostaPdfData } from '@/lib/proposta/dados'
import type { AnexoEmail } from '@/lib/engine/email/provider'
import { telefoneParaEnvio } from '@/lib/whatsapp/outbound'
import { COLUNAS_PROPOSTA, LIMITE_MENSAGEM_ENVIO, type CanalEnvioProposta, type PropostaRegistro } from './tipos'

// Envio de uma proposta SALVA ao cliente, com o PDF anexado
// (POST /api/propostas/[id]/enviar).
//
// Ordem — nada externo acontece antes de todas as travas passarem:
//   1. proposta e lead lidos na organização da SESSÃO (filtro explícito;
//      `db` é service_role e ignora RLS)
//   2. travas do lead: opt-out e perdido (os dois canais), bounce (e-mail) e
//      destino utilizável
//   3. PDF gerado do snapshot `dados_pdf` — exatamente a proposta salva
//   4. MODO_ENSAIO (e-mail): para aqui; nada enviado, nada gravado
//   5. trava contra envio simultâneo (`envio_iniciado_em`, expira em 2 min)
//   6. envio → proposta marcada como enviada → histórico do lead
// Depois que o provedor aceitou, falha de registro NÃO vira erro: o usuário
// reenviaria em dobro (mesmo contrato da Central de Respostas).
//
// Os canais chegam por `deps` (implementação real em ./canaisEnvio) para que
// os dois caminhos — ensaio e envio real — sejam testáveis sem rede.

export const TRAVA_ENVIO_MS = 2 * 60_000

export type CodigoErroEnvioProposta =
  | 'canal_invalido'
  | 'mensagem_vazia'
  | 'mensagem_longa'
  | 'assunto_vazio'
  | 'proposta_nao_encontrada'
  | 'lead_nao_encontrado'
  | 'optout'
  | 'bounced'
  | 'perdido'
  | 'sem_email'
  | 'sem_telefone'
  | 'falha_pdf'
  | 'envio_em_andamento'
  | 'credencial_ausente'
  | 'config_ausente'
  | 'whatsapp_indisponivel'
  | 'falha_envio'

export type ResultadoEnvioProposta =
  | { ok: true; simulado: true; motivo: 'modo_ensaio'; canal: 'email'; destino: string }
  | {
    ok: true
    simulado: false
    canal: CanalEnvioProposta
    destino: string
    // false = o cliente recebeu, mas algum registro local falhou. NÃO reenviar.
    registrada: boolean
    proposta: Omit<PropostaRegistro, 'leads'> | null
  }
  | { ok: false; codigo: CodigoErroEnvioProposta; mensagem: string }

type FalhaCanal<C extends CodigoErroEnvioProposta> = { ok: false; codigo: C; mensagem: string }

export interface DepsEnvioProposta {
  agora: () => Date
  modoEnsaioEmail: () => boolean
  gerarPdf: (dados: PropostaPdfData) => Promise<Uint8Array>
  enviarEmail: (e: {
    organizacaoId: string
    para: string
    assunto: string
    texto: string
    responsavelId: string | null
    anexo: AnexoEmail
  }) => Promise<{ ok: true } | FalhaCanal<'credencial_ausente' | 'falha_envio'>>
  enviarWhatsapp: (e: {
    organizacaoId: string
    leadId: string
    pdf: Uint8Array
    nomeArquivo: string
    legenda: string
  }) => Promise<
    | { ok: true; registrada: boolean }
    | FalhaCanal<'lead_nao_encontrado' | 'sem_telefone' | 'config_ausente' | 'whatsapp_indisponivel' | 'falha_envio'>
  >
}

interface LeadEnvio {
  id: string
  empresa: string | null
  contato_email: string | null
  contato_telefone: string | null
  optout: boolean | null
  bounced: boolean | null
  perdido: boolean | null
  responsavel_id: string | null
}

const falha = (codigo: CodigoErroEnvioProposta, mensagem: string): ResultadoEnvioProposta =>
  ({ ok: false, codigo, mensagem })

const textoErro = (e: unknown) => (e instanceof Error ? e.message : String(e))

// Log estruturado sem PII: nunca inclui e-mail, telefone nem o texto enviado.
function log(nivel: 'info' | 'erro', msg: string, extra: Record<string, unknown>) {
  const linha = JSON.stringify({ ts: new Date().toISOString(), nivel, escopo: 'propostas.envio', msg, ...extra })
  if (nivel === 'erro') console.error(linha)
  else console.log(linha)
}

export async function enviarProposta(
  db: SupabaseClient,
  entrada: { propostaId: string; organizacaoId: string; canal: unknown; assunto?: unknown; mensagem: unknown },
  deps: DepsEnvioProposta,
): Promise<ResultadoEnvioProposta> {
  const canal = entrada.canal
  if (canal !== 'email' && canal !== 'whatsapp') return falha('canal_invalido', 'Escolha e-mail ou WhatsApp.')
  const mensagem = typeof entrada.mensagem === 'string' ? entrada.mensagem.trim() : ''
  const assunto = typeof entrada.assunto === 'string' ? entrada.assunto.trim() : ''
  if (!mensagem) return falha('mensagem_vazia', 'Escreva a mensagem que acompanha a proposta.')
  if (mensagem.length > LIMITE_MENSAGEM_ENVIO) {
    return falha('mensagem_longa', `A mensagem passa do limite de ${LIMITE_MENSAGEM_ENVIO} caracteres.`)
  }
  if (canal === 'email' && !assunto) return falha('assunto_vazio', 'Informe o assunto do e-mail.')
  const org = entrada.organizacaoId

  // 1) ISOLAMENTO: proposta e lead só existem para a organização da sessão.
  const { data: propostaRow, error: erroProposta } = await db
    .from('propostas_comerciais')
    .select('id, lead_id, dados_pdf')
    .eq('id', entrada.propostaId)
    .eq('organizacao_id', org)
    .maybeSingle()
  if (erroProposta) throw erroProposta
  if (!propostaRow) return falha('proposta_nao_encontrada', 'Proposta não encontrada nesta organização.')
  const proposta = propostaRow as { id: string; lead_id: string; dados_pdf: PropostaPdfData }

  const { data: leadRow, error: erroLead } = await db
    .from('leads')
    .select('id, empresa, contato_email, contato_telefone, optout, bounced, perdido, responsavel_id')
    .eq('id', proposta.lead_id)
    .eq('organizacao_id', org)
    .maybeSingle()
  if (erroLead) throw erroLead
  if (!leadRow) return falha('lead_nao_encontrado', 'Lead da proposta não encontrado nesta organização.')
  const lead = leadRow as LeadEnvio

  // 2) Travas do lead — as mesmas que tiram o lead da esteira do motor.
  if (lead.optout) return falha('optout', 'Este lead pediu para não receber contatos (opt-out).')
  if (lead.perdido) return falha('perdido', 'Lead marcado como perdido. Reative-o antes de enviar.')
  let destino: string
  if (canal === 'email') {
    if (lead.bounced) {
      return falha('bounced', 'O e-mail deste lead devolveu (bounce). Corrija o endereço antes de enviar.')
    }
    destino = lead.contato_email?.trim() ?? ''
    if (!destino) return falha('sem_email', 'O lead não tem e-mail cadastrado.')
  } else {
    destino = telefoneParaEnvio(lead.contato_telefone) ?? ''
    if (!destino) return falha('sem_telefone', 'O lead não tem telefone em formato utilizável para WhatsApp.')
  }

  // 3) PDF do snapshot salvo.
  const inicio = deps.agora()
  const nomeArquivo = nomeArquivoProposta(lead.empresa, inicio)
  let pdf: Uint8Array
  try {
    pdf = await deps.gerarPdf(proposta.dados_pdf)
  } catch (e) {
    log('erro', 'Falha ao gerar o PDF da proposta.', { propostaId: proposta.id, organizacaoId: org, erro: textoErro(e) })
    return falha('falha_pdf', 'Não foi possível gerar o PDF da proposta.')
  }

  // 4) MODO_ENSAIO do motor de e-mail: simulação sem nenhum efeito persistente.
  //    (A Z-API não tem trava de ensaio — mesmo contrato do envio pela Central.)
  if (canal === 'email' && deps.modoEnsaioEmail()) {
    log('info', 'MODO_ENSAIO: proposta simulada, nada enviado nem registrado.', {
      propostaId: proposta.id, organizacaoId: org, bytesPdf: pdf.length,
    })
    return { ok: true, simulado: true, motivo: 'modo_ensaio', canal: 'email', destino }
  }

  // 5) Trava de envio: só um envio por vez para a mesma proposta. O update
  //    condicional é atômico no banco; zero linhas = outro envio em curso.
  const limiteTrava = new Date(inicio.getTime() - TRAVA_ENVIO_MS).toISOString()
  const { data: travadas, error: erroTrava } = await db
    .from('propostas_comerciais')
    .update({ envio_iniciado_em: inicio.toISOString() })
    .eq('id', proposta.id)
    .eq('organizacao_id', org)
    .or(`envio_iniciado_em.is.null,envio_iniciado_em.lt."${limiteTrava}"`)
    .select('id, envios')
  if (erroTrava) throw erroTrava
  const travada = (travadas as Array<{ id: string; envios: number | null }> | null)?.[0]
  if (!travada) {
    return falha('envio_em_andamento', 'Esta proposta já está sendo enviada. Aguarde alguns instantes.')
  }

  // 6) Envio.
  let envio: Awaited<ReturnType<DepsEnvioProposta['enviarEmail']>> | Awaited<ReturnType<DepsEnvioProposta['enviarWhatsapp']>>
  try {
    envio = canal === 'email'
      ? await deps.enviarEmail({
        organizacaoId: org,
        para: destino,
        assunto,
        texto: mensagem,
        responsavelId: lead.responsavel_id,
        anexo: { nomeArquivo, conteudo: pdf, tipo: 'application/pdf' },
      })
      : await deps.enviarWhatsapp({ organizacaoId: org, leadId: lead.id, pdf, nomeArquivo, legenda: mensagem })
  } catch (e) {
    envio = { ok: false, codigo: 'falha_envio', mensagem: `Falha ao enviar: ${textoErro(e)}` }
  }

  if (!envio.ok) {
    // Nada saiu: libera a trava para o usuário poder tentar de novo.
    const { error: erroLiberar } = await db
      .from('propostas_comerciais')
      .update({ envio_iniciado_em: null })
      .eq('id', proposta.id)
      .eq('organizacao_id', org)
    if (erroLiberar) {
      log('erro', 'Envio falhou e a trava não foi liberada (expira sozinha).', { propostaId: proposta.id, erro: erroLiberar.message })
    }
    return falha(envio.codigo, envio.mensagem)
  }

  // A partir daqui o cliente JÁ recebeu: nenhuma falha abaixo vira erro.
  const enviadaEm = deps.agora().toISOString()
  let registrada = true
  let atualizada: Omit<PropostaRegistro, 'leads'> | null = null

  const { data: atualizadaRow, error: erroAtualizar } = await db
    .from('propostas_comerciais')
    .update({
      status: 'enviada',
      enviada_em: enviadaEm,
      enviada_canal: canal,
      enviada_para: destino,
      envios: (travada.envios ?? 0) + 1,
      envio_iniciado_em: null,
    })
    .eq('id', proposta.id)
    .eq('organizacao_id', org)
    .select(COLUNAS_PROPOSTA)
    .maybeSingle()
  if (erroAtualizar) {
    registrada = false
    log('erro', 'Proposta enviada, mas falhou ao marcar como enviada.', { propostaId: proposta.id, erro: erroAtualizar.message })
  } else {
    atualizada = (atualizadaRow as unknown as Omit<PropostaRegistro, 'leads'> | null) ?? null
  }

  // Histórico do lead. O WhatsApp já fica em whatsapp_mensagens (aba Conversa).
  // O e-mail entra em `interacoes` como a Central faz (nota/email) — o que o
  // mostra na Conversa e alimenta o "último contato".
  if (canal === 'email') {
    const { error: erroInteracao } = await db.from('interacoes').insert({
      organizacao_id: org,
      lead_id: lead.id,
      tipo: 'nota',
      canal: 'email',
      descricao: `Proposta comercial enviada por e-mail (${nomeArquivo}).\n\n**${assunto}**\n\n${mensagem}`,
      origem_acao: 'humano',
      responsavel_id: lead.responsavel_id,
    })
    if (erroInteracao) {
      registrada = false
      log('erro', 'Proposta enviada, mas falhou ao registrar a interação.', { propostaId: proposta.id, erro: erroInteracao.message })
    } else {
      const { error: erroContato } = await db
        .from('leads')
        .update({ ultimo_contato: enviadaEm })
        .eq('id', lead.id)
        .eq('organizacao_id', org)
      if (erroContato) {
        log('erro', 'Interação registrada, mas o último contato não foi sincronizado.', { leadId: lead.id, erro: erroContato.message })
      }
    }
  } else if ('registrada' in envio && !envio.registrada) {
    registrada = false
  }

  log('info', 'Proposta enviada ao cliente.', { propostaId: proposta.id, organizacaoId: org, canal, registrada })
  return { ok: true, simulado: false, canal, destino, registrada, proposta: atualizada }
}
