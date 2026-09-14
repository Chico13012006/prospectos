import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ComandoGrupoRegistro, ComandoGrupoRepository, NovoComandoGrupo, StatusComandoGrupo } from './repository'
import type { ComandoGrupo } from './comandos'

// Implementação Supabase (service_role BYPASSA RLS → tudo escopado por org).

const COLS =
  'id, organizacao_id, grupo_id, provider_message_id, remetente, remetente_nome, texto, codigo_ref, ' +
  'comando, handoff_id, notificacao_id, status, resultado, erro, recebido_em, processado_em, atualizado_em'

type Linha = {
  id: string; organizacao_id: string; grupo_id: string; provider_message_id: string
  remetente: string | null; remetente_nome: string | null; texto: string; codigo_ref: string | null
  comando: ComandoGrupo | null; handoff_id: string | null; notificacao_id: string | null
  status: StatusComandoGrupo; resultado: string | null; erro: string | null
  recebido_em: string; processado_em: string | null; atualizado_em: string
}

export function mapearComando(l: Linha): ComandoGrupoRegistro {
  return {
    id: l.id, organizacaoId: l.organizacao_id, grupoId: l.grupo_id, providerMessageId: l.provider_message_id,
    remetente: l.remetente ?? null, remetenteNome: l.remetente_nome ?? null, texto: l.texto,
    codigoRef: l.codigo_ref ?? null, comando: l.comando ?? null, handoffId: l.handoff_id ?? null,
    notificacaoId: l.notificacao_id ?? null, status: l.status, resultado: l.resultado ?? null, erro: l.erro ?? null,
    recebidoEm: l.recebido_em, processadoEm: l.processado_em ?? null, atualizadoEm: l.atualizado_em,
  }
}

export class SupabaseComandoGrupoRepository implements ComandoGrupoRepository {
  constructor(private readonly admin: SupabaseClient) {}

  async resolverOrganizacoesDoGrupo(grupoId: string): Promise<string[]> {
    // O índice único da 0044 garante no máximo uma; o serviço trata 0 e N mesmo assim.
    const { data, error } = await this.admin
      .from('organizacoes')
      .select('id')
      .eq('configuracoes->comercial->>grupoWhatsappId', grupoId)
      .limit(5)
    if (error) throw new Error(error.message)
    return (data ?? []).map((o) => o.id as string)
  }

  async registrar(org: string, novo: NovoComandoGrupo): Promise<{ comando: ComandoGrupoRegistro; novo: boolean }> {
    const { data, error } = await this.admin
      .from('comercial_grupo_comandos')
      .upsert(
        {
          organizacao_id: org, grupo_id: novo.grupoId, provider_message_id: novo.providerMessageId,
          remetente: novo.remetente, remetente_nome: novo.remetenteNome, texto: novo.texto.slice(0, 2000),
          codigo_ref: novo.codigoRef, comando: novo.comando, recebido_em: novo.recebidoEm,
        },
        { onConflict: 'organizacao_id,provider_message_id', ignoreDuplicates: true },
      )
      .select(COLS)
    if (error) throw new Error(error.message)
    const inserida = ((data ?? []) as unknown as Linha[])[0]
    if (inserida) return { comando: mapearComando(inserida), novo: true }
    const { data: existente, error: e2 } = await this.admin
      .from('comercial_grupo_comandos')
      .select(COLS)
      .eq('organizacao_id', org)
      .eq('provider_message_id', novo.providerMessageId)
      .maybeSingle()
    if (e2) throw new Error(e2.message)
    if (!existente) throw new Error('comando não encontrado após registrar')
    return { comando: mapearComando(existente as unknown as Linha), novo: false }
  }

  async reivindicar(org: string, id: string, presoDesdeISO: string): Promise<boolean> {
    // Duas escritas mutuamente exclusivas: (a) recebido|falhou → processando;
    // (b) processando preso (sem atualização há mais de X) → processando de novo.
    const { data, error } = await this.admin
      .from('comercial_grupo_comandos')
      .update({ status: 'processando' })
      .eq('organizacao_id', org)
      .eq('id', id)
      .or(`status.in.(recebido,falhou),and(status.eq.processando,atualizado_em.lt.${presoDesdeISO})`)
      .select('id')
    if (error) throw new Error(error.message)
    return (data?.length ?? 0) > 0
  }

  async concluir(org: string, id: string, dados: { status: 'concluido' | 'ignorado'; resultado: string; handoffId?: string | null; notificacaoId?: string | null }): Promise<void> {
    const { error } = await this.admin
      .from('comercial_grupo_comandos')
      .update({
        status: dados.status, resultado: dados.resultado, erro: null, processado_em: new Date().toISOString(),
        ...(dados.handoffId !== undefined ? { handoff_id: dados.handoffId } : {}),
        ...(dados.notificacaoId !== undefined ? { notificacao_id: dados.notificacaoId } : {}),
      })
      .eq('organizacao_id', org)
      .eq('id', id)
    if (error) throw new Error(error.message)
  }

  async falhar(org: string, id: string, resultado: string, erro: string, refs: { handoffId?: string | null; notificacaoId?: string | null } = {}): Promise<void> {
    const { error } = await this.admin
      .from('comercial_grupo_comandos')
      .update({
        status: 'falhou', resultado, erro: erro.slice(0, 500),
        ...(refs.handoffId !== undefined ? { handoff_id: refs.handoffId } : {}),
        ...(refs.notificacaoId !== undefined ? { notificacao_id: refs.notificacaoId } : {}),
      })
      .eq('organizacao_id', org)
      .eq('id', id)
    if (error) throw new Error(error.message)
  }

  async listarReprocessaveis(org: string, presoDesdeISO: string, limite: number): Promise<ComandoGrupoRegistro[]> {
    const { data, error } = await this.admin
      .from('comercial_grupo_comandos')
      .select(COLS)
      .eq('organizacao_id', org)
      .or(`status.in.(recebido,falhou),and(status.eq.processando,atualizado_em.lt.${presoDesdeISO})`)
      .order('recebido_em', { ascending: true })
      .limit(limite)
    if (error) throw new Error(error.message)
    return ((data ?? []) as unknown as Linha[]).map(mapearComando)
  }
}
