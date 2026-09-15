// Quando uma campanha pode ser apagada. Regra única e sem I/O: a rota DELETE
// impõe e a lista de campanhas usa para bloquear o botão antes do clique.
//
// Pausada e rascunho não processam nada — o executor e a fila de disparo
// conferem a campanha antes de qualquer efeito e param se ela estiver pausada
// ou não existir mais —, então execuções pendentes delas saem junto. Ativa e
// concluída ainda deixam execuções em andamento terminarem.
export function motivoBloqueioExclusao(status: string, pendentes: number): string | null {
  if (status === 'ativa') return 'Pause a campanha antes de apagar.'
  if (pendentes > 0 && status !== 'pausada' && status !== 'rascunho') {
    return `Ainda há ${pendentes} execução(ões) em andamento. Aguarde terminarem antes de apagar.`
  }
  return null
}
