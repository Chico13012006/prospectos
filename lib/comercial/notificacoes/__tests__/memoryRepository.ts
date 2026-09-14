// Fake em memória do outbox de notificações (mesmas regras do Supabase:
// unique handoff+tipo, compare-and-swap em tentativas, escopo por org).
import { CodigoRefEmUsoError, type NotificacaoHandoffRepository } from '../repository'
import type { DadosAlertaHandoff, NotificacaoHandoff, TipoNotificacaoHandoff } from '../types'

const RECLAMAVEIS = new Set(['pendente', 'falhou', 'configuracao_ausente'])

export class MemoryNotificacaoRepository implements NotificacaoHandoffRepository {
  linhas: NotificacaoHandoff[] = []
  private seq = 0
  // Gancho para intercalar concorrentes entre a leitura e a reivindicação.
  antesDeReivindicar?: () => Promise<void>

  // Simula o índice único (org, codigo_ref): colisão lança como o Supabase.
  async registrarIntencao(org: string, handoffId: string, tipo: TipoNotificacaoHandoff, dados: DadosAlertaHandoff, opcoes: { codigoRef?: string } = {}): Promise<NotificacaoHandoff> {
    const existente = this.linhas.find((n) => n.handoffId === handoffId && n.tipo === tipo)
    if (existente) {
      if (existente.organizacaoId !== org) throw new Error('intenção de outra organização')
      return { ...existente }
    }
    const codigoRef = opcoes.codigoRef ?? null
    if (codigoRef && this.linhas.some((n) => n.organizacaoId === org && n.codigoRef === codigoRef)) {
      throw new CodigoRefEmUsoError('uniq_comercial_handoff_notificacoes_codigo')
    }
    const nova: NotificacaoHandoff = {
      id: `n${++this.seq}`, organizacaoId: org, handoffId, tipo, status: 'pendente', tentativas: 0,
      ultimoErro: null, dados: { ...dados }, destino: null, providerMessageId: null, enviadoEm: null,
      criadoEm: new Date(1_700_000_000_000 + this.seq * 1000).toISOString(), codigoRef,
    }
    this.linhas.push(nova)
    return { ...nova }
  }

  async buscarPorCodigo(org: string, codigoRef: string): Promise<NotificacaoHandoff | null> {
    const n = this.linhas.find((x) => x.organizacaoId === org && x.codigoRef === codigoRef)
    return n ? { ...n, dados: { ...n.dados } } : null
  }

  async buscar(org: string, id: string): Promise<NotificacaoHandoff | null> {
    const n = this.linhas.find((x) => x.id === id && x.organizacaoId === org)
    return n ? { ...n, dados: { ...n.dados } } : null
  }

  async reivindicarEnvio(org: string, id: string, tentativasEsperadas: number): Promise<boolean> {
    await this.antesDeReivindicar?.()
    const n = this.linhas.find((x) => x.id === id && x.organizacaoId === org)
    if (!n || !RECLAMAVEIS.has(n.status) || n.tentativas !== tentativasEsperadas) return false
    n.status = 'enviando'; n.tentativas = tentativasEsperadas + 1; n.ultimoErro = null
    return true
  }

  async marcarEnviada(org: string, id: string, info: { destino: string; providerMessageId: string | null }): Promise<void> {
    const n = this.linhas.find((x) => x.id === id && x.organizacaoId === org)
    if (!n) return
    Object.assign(n, { status: 'enviada', destino: info.destino, providerMessageId: info.providerMessageId, enviadoEm: new Date().toISOString(), ultimoErro: null })
  }

  async marcarFalha(org: string, id: string, erro: string): Promise<void> {
    const n = this.linhas.find((x) => x.id === id && x.organizacaoId === org)
    if (n) { n.status = 'falhou'; n.ultimoErro = erro }
  }

  async marcarConfiguracaoAusente(org: string, id: string, erro: string): Promise<void> {
    const n = this.linhas.find((x) => x.id === id && x.organizacaoId === org)
    if (n && RECLAMAVEIS.has(n.status)) { n.status = 'configuracao_ausente'; n.ultimoErro = erro }
  }

  async listarReprocessaveis(org: string, teto: number, limite: number): Promise<NotificacaoHandoff[]> {
    return this.linhas
      .filter((n) => n.organizacaoId === org && RECLAMAVEIS.has(n.status) && n.tentativas < teto)
      .slice(0, limite)
      .map((n) => ({ ...n }))
  }
  async listarPorHandoffs(org: string, tipo: TipoNotificacaoHandoff, handoffIds: string[]): Promise<NotificacaoHandoff[]> {
    const ids = new Set(handoffIds)
    return this.linhas.filter((n) => n.organizacaoId === org && n.tipo === tipo && ids.has(n.handoffId)).map((n) => ({ ...n }))
  }
}
