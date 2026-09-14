// Fake em memória do ComandoGrupoRepository (mesmas garantias do Supabase:
// unique org+messageId, claim por compare-and-swap, 'processando' preso).
import type { ComandoGrupoRegistro, ComandoGrupoRepository, NovoComandoGrupo } from '../repository'

export class MemoryComandoGrupoRepository implements ComandoGrupoRepository {
  linhas: ComandoGrupoRegistro[] = []
  // grupoId → organizações que o configuraram (normalmente 1).
  grupos = new Map<string, string[]>()
  private seq = 0
  agoraFixo: string | null = null
  antesDeReivindicar?: () => Promise<void>
  private agora() { return this.agoraFixo ?? new Date().toISOString() }

  configurarGrupo(org: string, grupoId: string) {
    this.grupos.set(grupoId, [...(this.grupos.get(grupoId) ?? []), org]); return this
  }

  async resolverOrganizacoesDoGrupo(grupoId: string): Promise<string[]> {
    return [...(this.grupos.get(grupoId) ?? [])]
  }

  async registrar(org: string, novo: NovoComandoGrupo) {
    const existente = this.linhas.find((c) => c.organizacaoId === org && c.providerMessageId === novo.providerMessageId)
    if (existente) return { comando: { ...existente }, novo: false }
    const c: ComandoGrupoRegistro = {
      id: `c${++this.seq}`, organizacaoId: org, grupoId: novo.grupoId, providerMessageId: novo.providerMessageId,
      remetente: novo.remetente, remetenteNome: novo.remetenteNome, texto: novo.texto, codigoRef: novo.codigoRef,
      comando: novo.comando, handoffId: null, notificacaoId: null, status: 'recebido', resultado: null, erro: null,
      recebidoEm: novo.recebidoEm, processadoEm: null, atualizadoEm: this.agora(),
    }
    this.linhas.push(c)
    return { comando: { ...c }, novo: true }
  }

  async reivindicar(org: string, id: string, presoDesdeISO: string): Promise<boolean> {
    await this.antesDeReivindicar?.()
    const c = this.linhas.find((x) => x.id === id && x.organizacaoId === org)
    if (!c) return false
    const pode = c.status === 'recebido' || c.status === 'falhou' || (c.status === 'processando' && c.atualizadoEm < presoDesdeISO)
    if (!pode) return false
    c.status = 'processando'; c.atualizadoEm = this.agora()
    return true
  }

  async concluir(org: string, id: string, dados: { status: 'concluido' | 'ignorado'; resultado: string; handoffId?: string | null; notificacaoId?: string | null }) {
    const c = this.linhas.find((x) => x.id === id && x.organizacaoId === org)
    if (!c) return
    Object.assign(c, { status: dados.status, resultado: dados.resultado, erro: null, processadoEm: this.agora(), atualizadoEm: this.agora() })
    if (dados.handoffId !== undefined) c.handoffId = dados.handoffId ?? null
    if (dados.notificacaoId !== undefined) c.notificacaoId = dados.notificacaoId ?? null
  }

  async falhar(org: string, id: string, resultado: string, erro: string, refs: { handoffId?: string | null; notificacaoId?: string | null } = {}) {
    const c = this.linhas.find((x) => x.id === id && x.organizacaoId === org)
    if (!c) return
    Object.assign(c, { status: 'falhou', resultado, erro, atualizadoEm: this.agora() })
    if (refs.handoffId !== undefined) c.handoffId = refs.handoffId ?? null
    if (refs.notificacaoId !== undefined) c.notificacaoId = refs.notificacaoId ?? null
  }

  async listarReprocessaveis(org: string, presoDesdeISO: string, limite: number): Promise<ComandoGrupoRegistro[]> {
    return this.linhas
      .filter((c) => c.organizacaoId === org && (c.status === 'recebido' || c.status === 'falhou' || (c.status === 'processando' && c.atualizadoEm < presoDesdeISO)))
      .slice(0, limite)
      .map((c) => ({ ...c }))
  }
}
