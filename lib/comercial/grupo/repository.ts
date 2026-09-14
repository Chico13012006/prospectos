// Contrato de persistência dos comandos do grupo (comercial_grupo_comandos,
// migration 0044) e da resolução grupo → organização. Toda operação é
// escopada por organizacao_id; a org NUNCA vem do callback — vem do grupo.
import type { ComandoGrupo } from './comandos'

export type StatusComandoGrupo = 'recebido' | 'processando' | 'concluido' | 'ignorado' | 'falhou'

export interface ComandoGrupoRegistro {
  id: string
  organizacaoId: string
  grupoId: string
  providerMessageId: string
  remetente: string | null
  remetenteNome: string | null
  texto: string
  codigoRef: string | null
  comando: ComandoGrupo | null
  handoffId: string | null
  notificacaoId: string | null
  status: StatusComandoGrupo
  resultado: string | null
  erro: string | null
  recebidoEm: string
  processadoEm: string | null
  atualizadoEm: string
}

export interface NovoComandoGrupo {
  grupoId: string
  providerMessageId: string
  remetente: string | null
  remetenteNome: string | null
  texto: string
  codigoRef: string | null
  comando: ComandoGrupo | null
  recebidoEm: string
}

export interface ComandoGrupoRepository {
  // Organizações cujo grupo comercial configurado é este id (0, 1 ou N).
  resolverOrganizacoesDoGrupo(grupoId: string): Promise<string[]>
  // Insere se não existir (unique org+messageId). Devolve a linha e se é nova.
  registrar(organizacaoId: string, novo: NovoComandoGrupo): Promise<{ comando: ComandoGrupoRegistro; novo: boolean }>
  // Claim por compare-and-swap: recebido|falhou → processando (ou um
  // 'processando' preso há mais de `presoDesdeISO`). false = outro venceu.
  reivindicar(organizacaoId: string, id: string, presoDesdeISO: string): Promise<boolean>
  concluir(organizacaoId: string, id: string, dados: { status: 'concluido' | 'ignorado'; resultado: string; handoffId?: string | null; notificacaoId?: string | null }): Promise<void>
  falhar(organizacaoId: string, id: string, resultado: string, erro: string, refs?: { handoffId?: string | null; notificacaoId?: string | null }): Promise<void>
  listarReprocessaveis(organizacaoId: string, presoDesdeISO: string, limite: number): Promise<ComandoGrupoRegistro[]>
}
