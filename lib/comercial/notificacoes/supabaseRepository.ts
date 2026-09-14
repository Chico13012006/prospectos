import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CodigoRefEmUsoError, type NotificacaoHandoffRepository } from './repository'
import type { DadosAlertaHandoff, NotificacaoHandoff, StatusNotificacaoHandoff, TipoNotificacaoHandoff } from './types'

// Implementação Supabase do outbox (migration 0042). Client admin (service_role
// BYPASSA RLS) → toda leitura/escrita filtra e grava organizacao_id.

const COLS =
  'id, organizacao_id, handoff_id, tipo, status, tentativas, ultimo_erro, dados, ' +
  'destino, provider_message_id, enviado_em, criado_em, codigo_ref'

type Linha = {
  id: string
  organizacao_id: string
  handoff_id: string
  tipo: TipoNotificacaoHandoff
  status: StatusNotificacaoHandoff
  tentativas: number
  ultimo_erro: string | null
  dados: Partial<DadosAlertaHandoff> | null
  destino: string | null
  provider_message_id: string | null
  enviado_em: string | null
  criado_em: string
  codigo_ref?: string | null
}

export function mapearNotificacao(l: Linha): NotificacaoHandoff {
  const d = l.dados ?? {}
  return {
    id: l.id,
    organizacaoId: l.organizacao_id,
    handoffId: l.handoff_id,
    tipo: l.tipo,
    status: l.status,
    tentativas: Number(l.tentativas ?? 0),
    ultimoErro: l.ultimo_erro ?? null,
    dados: {
      empresa: String(d.empresa ?? ''),
      contato: String(d.contato ?? ''),
      responsavelNome: String(d.responsavelNome ?? ''),
      motivo: d.motivo === 'reativacao' ? 'reativacao' : 'round_robin',
      etapaCadencia: String(d.etapaCadencia ?? ''),
      ...(typeof d.tempoEmContato === 'string' && d.tempoEmContato ? { tempoEmContato: d.tempoEmContato } : {}),
    },
    destino: l.destino ?? null,
    providerMessageId: l.provider_message_id ?? null,
    enviadoEm: l.enviado_em ?? null,
    criadoEm: l.criado_em,
    codigoRef: l.codigo_ref ?? null,
  }
}


const RECLAMAVEIS: StatusNotificacaoHandoff[] = ['pendente', 'falhou', 'configuracao_ausente']

export class SupabaseNotificacaoHandoffRepository implements NotificacaoHandoffRepository {
  constructor(private readonly admin: SupabaseClient) {}

  async registrarIntencao(org: string, handoffId: string, tipo: TipoNotificacaoHandoff, dados: DadosAlertaHandoff, opcoes: { codigoRef?: string } = {}): Promise<NotificacaoHandoff> {
    // ignoreDuplicates: o índice único (handoff_id, tipo) segura a corrida —
    // dois eventos do mesmo handoff nunca criam duas intenções.
    const { error } = await this.admin
      .from('comercial_handoff_notificacoes')
      .upsert(
        { organizacao_id: org, handoff_id: handoffId, tipo, status: 'pendente', dados, codigo_ref: opcoes.codigoRef ?? null },
        { onConflict: 'handoff_id,tipo', ignoreDuplicates: true },
      )
    if (error) {
      if (error.message.includes('uniq_comercial_handoff_notificacoes_codigo')) throw new CodigoRefEmUsoError(error.message)
      throw new Error(error.message)
    }
    const existente = await this.buscarPorHandoff(org, handoffId, tipo)
    if (!existente) throw new Error('notificação do handoff não encontrada após registrar a intenção')
    return existente
  }

  private async buscarPorHandoff(org: string, handoffId: string, tipo: TipoNotificacaoHandoff): Promise<NotificacaoHandoff | null> {
    const { data, error } = await this.admin
      .from('comercial_handoff_notificacoes')
      .select(COLS)
      .eq('organizacao_id', org)
      .eq('handoff_id', handoffId)
      .eq('tipo', tipo)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return data ? mapearNotificacao(data as unknown as Linha) : null
  }

  async buscarPorCodigo(org: string, codigoRef: string): Promise<NotificacaoHandoff | null> {
    const { data, error } = await this.admin
      .from('comercial_handoff_notificacoes')
      .select(COLS)
      .eq('organizacao_id', org)
      .eq('codigo_ref', codigoRef)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return data ? mapearNotificacao(data as unknown as Linha) : null
  }

  async buscar(org: string, id: string): Promise<NotificacaoHandoff | null> {
    const { data, error } = await this.admin
      .from('comercial_handoff_notificacoes')
      .select(COLS)
      .eq('organizacao_id', org)
      .eq('id', id)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return data ? mapearNotificacao(data as unknown as Linha) : null
  }

  async reivindicarEnvio(org: string, id: string, tentativasEsperadas: number): Promise<boolean> {
    const { data, error } = await this.admin
      .from('comercial_handoff_notificacoes')
      .update({ status: 'enviando', tentativas: tentativasEsperadas + 1, ultimo_erro: null })
      .eq('organizacao_id', org)
      .eq('id', id)
      .in('status', RECLAMAVEIS)
      .eq('tentativas', tentativasEsperadas)
      .select('id')
    if (error) throw new Error(error.message)
    return (data?.length ?? 0) > 0
  }

  async marcarEnviada(org: string, id: string, info: { destino: string; providerMessageId: string | null }): Promise<void> {
    const { error } = await this.admin
      .from('comercial_handoff_notificacoes')
      .update({ status: 'enviada', destino: info.destino, provider_message_id: info.providerMessageId, enviado_em: new Date().toISOString(), ultimo_erro: null })
      .eq('organizacao_id', org)
      .eq('id', id)
    if (error) throw new Error(error.message)
  }

  async marcarFalha(org: string, id: string, erro: string): Promise<void> {
    const { error } = await this.admin
      .from('comercial_handoff_notificacoes')
      .update({ status: 'falhou', ultimo_erro: erro.slice(0, 500) })
      .eq('organizacao_id', org)
      .eq('id', id)
    if (error) throw new Error(error.message)
  }

  async marcarConfiguracaoAusente(org: string, id: string, erro: string): Promise<void> {
    const { error } = await this.admin
      .from('comercial_handoff_notificacoes')
      .update({ status: 'configuracao_ausente', ultimo_erro: erro.slice(0, 500) })
      .eq('organizacao_id', org)
      .eq('id', id)
      .in('status', RECLAMAVEIS)
    if (error) throw new Error(error.message)
  }

  async listarReprocessaveis(org: string, tetoTentativas: number, limite: number): Promise<NotificacaoHandoff[]> {
    const { data, error } = await this.admin
      .from('comercial_handoff_notificacoes')
      .select(COLS)
      .eq('organizacao_id', org)
      .in('status', RECLAMAVEIS)
      .lt('tentativas', tetoTentativas)
      .order('criado_em', { ascending: true })
      .limit(limite)
    if (error) throw new Error(error.message)
    return ((data ?? []) as unknown as Linha[]).map(mapearNotificacao)
  }
  async listarPorHandoffs(org: string, tipo: TipoNotificacaoHandoff, handoffIds: string[]): Promise<NotificacaoHandoff[]> {
    if (handoffIds.length === 0) return []
    const { data, error } = await this.admin
      .from('comercial_handoff_notificacoes')
      .select(COLS)
      .eq('organizacao_id', org)
      .eq('tipo', tipo)
      .in('handoff_id', handoffIds)
    if (error) throw new Error(error.message)
    return ((data ?? []) as unknown as Linha[]).map(mapearNotificacao)
  }
}
