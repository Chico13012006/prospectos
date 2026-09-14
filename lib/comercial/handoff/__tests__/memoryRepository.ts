// Fake em memória do HandoffRepository para os testes do serviço.
//
// `confirmar()` reproduz PASSO A PASSO a função comercial_handoff_confirmar da
// migration 0041 (mesma ordem de checagens, mesmos resultados, compare-and-swap
// no cursor) e é TRANSACIONAL: a seção crítica é síncrona (atômica no event loop)
// e qualquer exceção restaura o estado anterior — como o rollback do Postgres.
// Ganchos (`hooks`) permitem intercalar dois handoffs no mesmo estado e injetar
// falha no meio da confirmação. A prova no Postgres real é o script E2E
// (scripts/test-handoff-e2e.mjs); aqui provamos o SERVIÇO.
import type {
  DecisaoHandoff,
  HandoffRepository,
  HistoricoHandoffLead,
  LeadHandoffView,
  ResultadoConfirmacao,
} from '../repository'
import type { ComercialParticipante, CursorDistribuicao, EntradaHandoff, MotivoEncerramentoHandoff, RegistroHandoff } from '../types'

export interface UsuarioFake {
  id: string
  organizacaoId: string
  nome: string
  email?: string | null
  ativo?: boolean
}

export interface LeadFake {
  id: string
  organizacaoId: string
  responsavelId?: string | null
  responsavelNome?: string | null
  empresa?: string
  contatoNome?: string
}

export interface HooksFake {
  aoLerCursor?: (org: string) => Promise<void>
  antesDeConfirmar?: (entrada: EntradaHandoff, decisao: DecisaoHandoff) => Promise<void>
  // Lança no meio da confirmação (depois do cursor / depois do registro).
  falharEm?: 'apos_cursor' | 'apos_registro' | null
}

interface Estado {
  usuarios: Map<string, UsuarioFake>
  leads: Map<string, LeadFake>
  participantes: Map<string, boolean>            // `${org}:${usuarioId}` → participa
  cursores: Map<string, CursorDistribuicao>      // org → cursor
  handoffs: RegistroHandoff[]
}

const chave = (org: string, usuarioId: string) => `${org}:${usuarioId}`

export class MemoryHandoffRepository implements HandoffRepository {
  private estado: Estado = {
    usuarios: new Map(),
    leads: new Map(),
    participantes: new Map(),
    cursores: new Map(),
    handoffs: [],
  }
  private seq = 0
  private relogio = 0
  hooks: HooksFake = {}

  // --- montagem do cenário ---------------------------------------------------
  addUsuario(u: UsuarioFake) { this.estado.usuarios.set(u.id, { ativo: true, email: null, ...u }); return this }
  addLead(l: LeadFake) { this.estado.leads.set(l.id, { responsavelId: null, responsavelNome: null, ...l }); return this }
  participar(org: string, usuarioId: string, participa = true) {
    this.estado.participantes.set(chave(org, usuarioId), participa); return this
  }
  desativarUsuario(id: string) { const u = this.estado.usuarios.get(id); if (u) u.ativo = false; return this }
  removerUsuario(id: string) {
    // Espelha os ON DELETE do schema: cascade nos participantes, set null no
    // cursor, nos handoffs e nos leads.
    this.estado.usuarios.delete(id)
    for (const k of [...this.estado.participantes.keys()]) if (k.endsWith(`:${id}`)) this.estado.participantes.delete(k)
    for (const c of this.estado.cursores.values()) if (c.ultimoUsuarioId === id) c.ultimoUsuarioId = null
    for (const h of this.estado.handoffs) if (h.responsavelId === id) h.responsavelId = null
    for (const l of this.estado.leads.values()) if (l.responsavelId === id) l.responsavelId = null
    return this
  }
  // Fases futuras encerram o handoff; aqui só para simular "voltou ao follow-up".
  encerrarHandoff(id: string) {
    const h = this.estado.handoffs.find((x) => x.id === id)
    if (h) h.encerradoEm = this.agora()
    return this
  }

  // --- inspeção ----------------------------------------------------------------
  lead(id: string) { return this.estado.leads.get(id) ?? null }
  cursor(org: string): CursorDistribuicao { return { ...(this.estado.cursores.get(org) ?? { ultimoUsuarioId: null, versao: 0 }) } }
  handoffs(org?: string) { return this.estado.handoffs.filter((h) => !org || h.organizacaoId === org).map((h) => ({ ...h })) }

  // Relógio injetável: os testes de acompanhamento fixam `agoraFixo` para
  // controlar atribuido_em; sem ele, um relógio lógico determinístico.
  agoraFixo: string | null = null
  private agora() {
    if (this.agoraFixo) return this.agoraFixo
    this.relogio += 1; return new Date(1_700_000_000_000 + this.relogio * 1000).toISOString()
  }

  // --- HandoffRepository -------------------------------------------------------
  async buscarLead(org: string, leadId: string): Promise<LeadHandoffView | null> {
    const l = this.estado.leads.get(leadId)
    if (!l || l.organizacaoId !== org) return null
    return { id: l.id, responsavelId: l.responsavelId ?? null, empresa: l.empresa ?? '', contatoNome: l.contatoNome ?? '' }
  }

  async buscarHandoffAberto(org: string, leadId: string): Promise<RegistroHandoff | null> {
    const h = this.estado.handoffs.find((x) => x.organizacaoId === org && x.leadId === leadId && x.encerradoEm === null)
    return h ? { ...h } : null
  }

  async buscarHistorico(org: string, leadId: string): Promise<HistoricoHandoffLead> {
    const atribuidos = this.estado.handoffs
      .filter((x) => x.organizacaoId === org && x.leadId === leadId && x.status === 'em_contato_comercial')
      .sort((a, b) => (a.criadoEm < b.criadoEm ? 1 : -1))
    const ultimo = atribuidos[0]
    if (!ultimo) return { jaTeveAtribuicao: false, responsavelPreservavel: null }
    if (!ultimo.responsavelId) return { jaTeveAtribuicao: true, responsavelPreservavel: null }
    const u = this.estado.usuarios.get(ultimo.responsavelId)
    const preservavel = u && u.organizacaoId === org && u.ativo !== false ? { usuarioId: u.id, nome: u.nome } : null
    return { jaTeveAtribuicao: true, responsavelPreservavel: preservavel }
  }

  async listarDistribuicao(org: string): Promise<ComercialParticipante[]> {
    return [...this.estado.usuarios.values()]
      .filter((u) => u.organizacaoId === org && u.ativo !== false)
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
      .map((u) => ({
        usuarioId: u.id, nome: u.nome, email: u.email ?? null,
        participa: this.estado.participantes.get(chave(org, u.id)) ?? false,
      }))
  }

  async lerCursor(org: string): Promise<CursorDistribuicao> {
    await this.hooks.aoLerCursor?.(org)
    return this.cursor(org)
  }

  async confirmar(entrada: EntradaHandoff, decisao: DecisaoHandoff): Promise<ResultadoConfirmacao> {
    await this.hooks.antesDeConfirmar?.(entrada, decisao)
    // Seção crítica SÍNCRONA (= transação serializada pelo advisory lock).
    const snapshot = this.snapshot()
    try {
      return this.confirmarAtomico(entrada, decisao)
    } catch (e) {
      this.estado = snapshot // rollback
      throw e
    }
  }

  private confirmarAtomico(entrada: EntradaHandoff, d: DecisaoHandoff): ResultadoConfirmacao {
    const { organizacaoId: org, leadId, eventoId } = entrada
    const lead = this.estado.leads.get(leadId)
    if (!lead || lead.organizacaoId !== org) return { resultado: 'lead_nao_encontrado' }

    const aberto = this.estado.handoffs.find((x) => x.organizacaoId === org && x.leadId === leadId && x.encerradoEm === null)
    if (aberto && aberto.status === 'em_contato_comercial') {
      return { resultado: aberto.eventoId === eventoId ? 'ja_processado' : 'ja_em_contato_comercial', handoff: { ...aberto } }
    }

    if (d.responsavelId === null) {
      if (aberto) return { resultado: 'aguardando_distribuicao', handoff: { ...aberto } }
      const novo = this.novoRegistro(entrada, { status: 'aguardando_distribuicao' })
      this.estado.handoffs.push(novo)
      return { resultado: 'aguardando_distribuicao', handoff: { ...novo } }
    }

    const u = this.estado.usuarios.get(d.responsavelId)
    const elegivel = !!u && u.organizacaoId === org && u.ativo !== false
      && (d.motivo === 'reativacao' || this.estado.participantes.get(chave(org, u.id)) === true)
    if (!elegivel) return { resultado: 'participante_inelegivel' }

    if (d.motivo === 'round_robin') {
      const cursor = this.estado.cursores.get(org) ?? { ultimoUsuarioId: null, versao: 0 }
      if (cursor.versao !== (d.cursorVersaoEsperada ?? -1)) return { resultado: 'conflito_cursor' }
      this.estado.cursores.set(org, { ultimoUsuarioId: d.responsavelId, versao: cursor.versao + 1 })
    }
    if (this.hooks.falharEm === 'apos_cursor') throw new Error('falha injetada após o cursor')

    let registro: RegistroHandoff
    if (aberto) {
      Object.assign(aberto, {
        responsavelId: d.responsavelId, motivo: d.motivo, primeiraAtribuicao: d.primeiraAtribuicao ?? true,
        status: 'em_contato_comercial', atribuidoEm: this.agora(),
      })
      registro = aberto
    } else {
      registro = this.novoRegistro(entrada, {
        responsavelId: d.responsavelId, motivo: d.motivo, primeiraAtribuicao: d.primeiraAtribuicao ?? true,
        status: 'em_contato_comercial', atribuidoEm: this.agora(),
      })
      this.estado.handoffs.push(registro)
    }
    if (this.hooks.falharEm === 'apos_registro') throw new Error('falha injetada após o registro')

    lead.responsavelId = d.responsavelId
    lead.responsavelNome = u!.nome
    return { resultado: 'confirmado', handoff: { ...registro } }
  }

  private novoRegistro(entrada: EntradaHandoff, extra: Partial<RegistroHandoff>): RegistroHandoff {
    this.seq += 1
    return {
      id: `h${this.seq}`,
      organizacaoId: entrada.organizacaoId,
      leadId: entrada.leadId,
      eventoId: entrada.eventoId,
      origem: entrada.origem,
      responsavelId: null,
      motivo: null,
      primeiraAtribuicao: null,
      status: 'aguardando_distribuicao',
      atribuidoEm: null,
      encerradoEm: null,
      encerradoMotivo: null,
      criadoEm: this.agora(),
      ...extra,
    }
  }

  async buscarHandoff(org: string, handoffId: string): Promise<RegistroHandoff | null> {
    const h = this.estado.handoffs.find((x) => x.id === handoffId && x.organizacaoId === org)
    return h ? { ...h } : null
  }

  async encerrar(org: string, handoffId: string, motivo: MotivoEncerramentoHandoff): Promise<'encerrado' | 'ja_encerrado' | 'nao_encontrado'> {
    const h = this.estado.handoffs.find((x) => x.id === handoffId && x.organizacaoId === org)
    if (!h) return 'nao_encontrado'
    if (h.encerradoEm) return 'ja_encerrado'
    h.encerradoEm = this.agora(); h.encerradoMotivo = motivo
    return 'encerrado'
  }

  async listarAbertos(org: string, limite: number): Promise<RegistroHandoff[]> {
    return this.estado.handoffs
      .filter((h) => h.organizacaoId === org && h.status === 'em_contato_comercial' && h.encerradoEm === null
        && h.responsavelId !== null && h.atribuidoEm !== null)
      .sort((a, b) => (a.atribuidoEm! < b.atribuidoEm! ? -1 : 1))
      .slice(0, limite)
      .map((h) => ({ ...h }))
  }

  async definirParticipacao(org: string, usuarioId: string, participa: boolean): Promise<'ok' | 'usuario_nao_encontrado'> {
    const u = this.estado.usuarios.get(usuarioId)
    if (!u || u.organizacaoId !== org || u.ativo === false) return 'usuario_nao_encontrado'
    this.estado.participantes.set(chave(org, usuarioId), participa)
    return 'ok'
  }

  private snapshot(): Estado {
    return {
      usuarios: new Map([...this.estado.usuarios].map(([k, v]) => [k, { ...v }])),
      leads: new Map([...this.estado.leads].map(([k, v]) => [k, { ...v }])),
      participantes: new Map(this.estado.participantes),
      cursores: new Map([...this.estado.cursores].map(([k, v]) => [k, { ...v }])),
      handoffs: this.estado.handoffs.map((h) => ({ ...h })),
    }
  }
}
