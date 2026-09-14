import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  DecisaoHandoff,
  HandoffRepository,
  HistoricoHandoffLead,
  LeadHandoffView,
  ResultadoConfirmacao,
} from './repository'
import type { ComercialParticipante, CursorDistribuicao, EntradaHandoff, MotivoEncerramentoHandoff, RegistroHandoff } from './types'

// Implementação Supabase do HandoffRepository (migration 0041). Usa o client
// admin (service_role, que BYPASSA RLS) — por isso TODA leitura e escrita filtra
// e grava organizacao_id explicitamente; a RLS de leitura é só o backstop. A
// escrita que atribui é uma única RPC atômica (comercial_handoff_confirmar).

const COLS_HANDOFF =
  'id, organizacao_id, lead_id, evento_id, origem, responsavel_id, motivo, ' +
  'primeira_atribuicao, status, atribuido_em, encerrado_em, encerrado_motivo, criado_em'

type LinhaHandoff = {
  id: string
  organizacao_id: string
  lead_id: string
  evento_id: string
  origem: string
  responsavel_id: string | null
  motivo: RegistroHandoff['motivo']
  primeira_atribuicao: boolean | null
  status: RegistroHandoff['status']
  atribuido_em: string | null
  encerrado_em: string | null
  encerrado_motivo?: string | null
  criado_em: string
}

export function mapearRegistroHandoff(l: LinhaHandoff): RegistroHandoff {
  return {
    id: l.id,
    organizacaoId: l.organizacao_id,
    leadId: l.lead_id,
    eventoId: l.evento_id,
    origem: l.origem,
    responsavelId: l.responsavel_id ?? null,
    motivo: l.motivo ?? null,
    primeiraAtribuicao: l.primeira_atribuicao ?? null,
    status: l.status,
    atribuidoEm: l.atribuido_em ?? null,
    encerradoEm: l.encerrado_em ?? null,
    encerradoMotivo: l.encerrado_motivo ?? null,
    criadoEm: l.criado_em,
  }
}

export class SupabaseHandoffRepository implements HandoffRepository {
  constructor(private readonly admin: SupabaseClient) {}

  async buscarLead(org: string, leadId: string): Promise<LeadHandoffView | null> {
    const { data, error } = await this.admin
      .from('leads')
      .select('id, responsavel_id, empresa, contato_nome')
      .eq('organizacao_id', org)
      .eq('id', leadId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return null
    return {
      id: data.id as string,
      responsavelId: (data.responsavel_id as string | null) ?? null,
      empresa: (data.empresa as string | null) ?? '',
      contatoNome: (data.contato_nome as string | null) ?? '',
    }
  }

  async buscarHandoffAberto(org: string, leadId: string): Promise<RegistroHandoff | null> {
    const { data, error } = await this.admin
      .from('comercial_handoffs')
      .select(COLS_HANDOFF)
      .eq('organizacao_id', org)
      .eq('lead_id', leadId)
      .is('encerrado_em', null)
      .limit(1)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return data ? mapearRegistroHandoff(data as unknown as LinhaHandoff) : null
  }

  async buscarHistorico(org: string, leadId: string): Promise<HistoricoHandoffLead> {
    // Handoff mais recente que chegou a atribuir alguém (mesmo que o usuário
    // tenha saído depois — responsavel_id fica null pelo ON DELETE SET NULL).
    const { data: atribuidos, error: e1 } = await this.admin
      .from('comercial_handoffs')
      .select('responsavel_id')
      .eq('organizacao_id', org)
      .eq('lead_id', leadId)
      .eq('status', 'em_contato_comercial')
      .order('criado_em', { ascending: false })
      .limit(1)
    if (e1) throw new Error(e1.message)
    const ultimo = (atribuidos ?? [])[0] as { responsavel_id: string | null } | undefined
    if (!ultimo) return { jaTeveAtribuicao: false, responsavelPreservavel: null }
    if (!ultimo.responsavel_id) return { jaTeveAtribuicao: true, responsavelPreservavel: null }

    // Só preserva quem ainda existe ATIVO nesta organização.
    const { data: usuario, error: e2 } = await this.admin
      .from('usuarios')
      .select('id, nome')
      .eq('organizacao_id', org)
      .eq('id', ultimo.responsavel_id)
      .eq('ativo', true)
      .maybeSingle()
    if (e2) throw new Error(e2.message)
    return {
      jaTeveAtribuicao: true,
      responsavelPreservavel: usuario ? { usuarioId: usuario.id as string, nome: (usuario.nome as string) ?? '' } : null,
    }
  }

  async listarDistribuicao(org: string): Promise<ComercialParticipante[]> {
    const [{ data: usuarios, error: e1 }, { data: participantes, error: e2 }] = await Promise.all([
      this.admin
        .from('usuarios')
        .select('id, nome, email')
        .eq('organizacao_id', org)
        .eq('ativo', true)
        .order('nome'),
      this.admin
        .from('comercial_distribuicao_participantes')
        .select('usuario_id, participa')
        .eq('organizacao_id', org),
    ])
    if (e1) throw new Error(e1.message)
    if (e2) throw new Error(e2.message)
    const participa = new Map((participantes ?? []).map((p) => [p.usuario_id as string, p.participa === true]))
    return (usuarios ?? []).map((u) => ({
      usuarioId: u.id as string,
      nome: (u.nome as string) ?? '',
      email: (u.email as string | null) ?? null,
      participa: participa.get(u.id as string) ?? false,
    }))
  }

  async lerCursor(org: string): Promise<CursorDistribuicao> {
    const { data, error } = await this.admin
      .from('comercial_distribuicao_cursor')
      .select('ultimo_usuario_id, versao')
      .eq('organizacao_id', org)
      .maybeSingle()
    if (error) throw new Error(error.message)
    // Sem linha = rodízio nunca rodou. A RPC cria a linha (versao 0) ao confirmar.
    if (!data) return { ultimoUsuarioId: null, versao: 0 }
    return { ultimoUsuarioId: (data.ultimo_usuario_id as string | null) ?? null, versao: Number(data.versao ?? 0) }
  }

  async confirmar(entrada: EntradaHandoff, decisao: DecisaoHandoff): Promise<ResultadoConfirmacao> {
    const { data, error } = await this.admin.rpc('comercial_handoff_confirmar', {
      p_organizacao_id: entrada.organizacaoId,
      p_lead_id: entrada.leadId,
      p_evento_id: entrada.eventoId,
      p_origem: entrada.origem,
      p_responsavel_id: decisao.responsavelId,
      p_motivo: decisao.motivo,
      p_primeira_atribuicao: decisao.primeiraAtribuicao,
      p_cursor_versao_esperada: decisao.cursorVersaoEsperada,
    })
    if (error) throw new Error(error.message)
    const r = data as { resultado: string; handoff?: LinhaHandoff } | null
    switch (r?.resultado) {
      case 'confirmado':
      case 'aguardando_distribuicao':
      case 'ja_processado':
      case 'ja_em_contato_comercial':
        if (!r.handoff) throw new Error(`comercial_handoff_confirmar: '${r.resultado}' sem handoff`)
        return { resultado: r.resultado, handoff: mapearRegistroHandoff(r.handoff) }
      case 'lead_nao_encontrado':
      case 'participante_inelegivel':
      case 'conflito_cursor':
        return { resultado: r.resultado }
      default:
        throw new Error(`comercial_handoff_confirmar: resultado desconhecido (${String(r?.resultado)})`)
    }
  }

  async definirParticipacao(org: string, usuarioId: string, participa: boolean): Promise<'ok' | 'usuario_nao_encontrado'> {
    // Só comerciais ATIVOS desta org entram na lista (a FK composta da tabela
    // é o backstop contra usuário de outra organização).
    const { data: usuario, error: e1 } = await this.admin
      .from('usuarios')
      .select('id')
      .eq('organizacao_id', org)
      .eq('id', usuarioId)
      .eq('ativo', true)
      .maybeSingle()
    if (e1) throw new Error(e1.message)
    if (!usuario) return 'usuario_nao_encontrado'

    const { error: e2 } = await this.admin
      .from('comercial_distribuicao_participantes')
      .upsert(
        { organizacao_id: org, usuario_id: usuarioId, participa },
        { onConflict: 'organizacao_id,usuario_id' },
      )
    if (e2) throw new Error(e2.message)
    return 'ok'
  }
  async buscarHandoff(org: string, handoffId: string): Promise<RegistroHandoff | null> {
    const { data, error } = await this.admin
      .from('comercial_handoffs')
      .select(COLS_HANDOFF)
      .eq('organizacao_id', org)
      .eq('id', handoffId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return data ? mapearRegistroHandoff(data as unknown as LinhaHandoff) : null
  }

  async encerrar(org: string, handoffId: string, motivo: MotivoEncerramentoHandoff): Promise<'encerrado' | 'ja_encerrado' | 'nao_encontrado'> {
    // Só fecha o que está aberto: repetir é no-op (idempotente).
    const { data, error } = await this.admin
      .from('comercial_handoffs')
      .update({ encerrado_em: new Date().toISOString(), encerrado_motivo: motivo })
      .eq('organizacao_id', org)
      .eq('id', handoffId)
      .is('encerrado_em', null)
      .select('id')
    if (error) throw new Error(error.message)
    if ((data?.length ?? 0) > 0) return 'encerrado'
    const atual = await this.buscarHandoff(org, handoffId)
    return atual ? 'ja_encerrado' : 'nao_encontrado'
  }

  async listarAbertos(org: string, limite: number): Promise<RegistroHandoff[]> {
    const { data, error } = await this.admin
      .from('comercial_handoffs')
      .select(COLS_HANDOFF)
      .eq('organizacao_id', org)
      .eq('status', 'em_contato_comercial')
      .is('encerrado_em', null)
      .not('responsavel_id', 'is', null)
      .order('atribuido_em', { ascending: true })
      .limit(limite)
    if (error) throw new Error(error.message)
    return ((data ?? []) as unknown as LinhaHandoff[]).map(mapearRegistroHandoff)
  }
}
