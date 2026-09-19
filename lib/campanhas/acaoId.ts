// Identidade estável de cada mensagem da campanha guiada — a base da futura
// idempotência de envio (envios_idempotencia.acao_chave). Funções PURAS e
// determinísticas (sem I/O), para poderem ser testadas isoladamente e
// reusadas tanto pelo save do wizard (materializarServidor.ts) quanto por um
// backfill de dados (scripts/backfill-acao-ids-legado.ts).
//
// Regra central: uma vez atribuído, `acaoId` NUNCA é recalculado. A posição
// no array (`mensagemInicial` + `followups`, nessa ordem) só é consultada UMA
// vez por mensagem — na primeira materialização dela — e só para decidir o
// valor inicial. Depois disso, o id viaja COM o objeto da mensagem, não com o
// índice: reordenar, inserir ou remover mensagens vizinhas não o afeta.
//
// Campanha legada (publicada antes desta migração, sem `acaoId` salvo): o
// valor correto não é um UUID novo — é o `id` que a versão JÁ PUBLICADA usa
// para aquele passo (ex.: 'email-0'), porque é esse valor que já está gravado
// nos `workflow_execucoes`/`interacoes` históricos. Inventar um UUID novo aqui
// quebraria a invariante "mesmo valor em toda parte" para o histórico real.
import type { DefinicaoWorkflow } from '@/lib/workflows/types'
import type { FollowupCampanha, MensagemCampanha } from '@/components/automacao/tiposCampanha'

/**
 * IDs dos passos `enviar_email` de uma definição JÁ PUBLICADA, na ordem em que
 * aparecem — a mesma ordem em que `montarDefinicaoCampanha` os gera a partir
 * de `[mensagemInicial, ...followups]`. `null`/sem versão publicada → lista
 * vazia (campanha nova, nada para herdar).
 */
export function extrairAcaoIdsPublicados(def: DefinicaoWorkflow | null | undefined): string[] {
  if (!def?.acoes) return []
  return def.acoes
    .filter((acao) => acao.tipo === 'enviar_email' && typeof acao.id === 'string' && acao.id)
    .map((acao) => acao.id as string)
}

export interface GeradorId {
  (): string
}

/**
 * Preenche `acaoId` de cada mensagem (mensagemInicial + followups, na ordem),
 * seguindo a prioridade:
 *   1. `acaoId` já presente na própria mensagem → mantém, sempre (nunca
 *      recalcula — é o que garante "re-save preserva", "reordenar preserva
 *      por mensagem", "inserir/remover não afeta as demais").
 *   2. Campanha legada: existe uma versão publicada e ainda sobra um id dela
 *      na posição corrente → herda esse id (preserva o histórico real).
 *   3. Nenhum dos dois → mensagem genuinamente nova (ou campanha clonada, que
 *      deve chegar aqui SEM `acaoId` de propósito) → UUID novo via `gerarId`.
 *
 * Pura: não muta a entrada, não lê nem grava nada. `idsPublicados` só é usado
 * enquanto ainda há mensagens SEM `acaoId` próprio para consumi-lo — uma vez
 * que a mensagem já tem `acaoId`, a posição dela deixa de importar.
 */
export function resolverAcaoIds(
  mensagens: MensagemCampanha[],
  idsPublicados: string[],
  gerarId: GeradorId,
): MensagemCampanha[] {
  let proximoPublicado = 0
  return mensagens.map((mensagem) => {
    if (mensagem.acaoId) return mensagem
    const herdado = idsPublicados[proximoPublicado]
    proximoPublicado += 1
    return { ...mensagem, acaoId: herdado ?? gerarId() }
  })
}

/** Lista ordenada [mensagemInicial, ...followups] — mesma ordem de sempre. */
export function mensagensNaOrdem(
  mensagemInicial: MensagemCampanha | undefined,
  followups: FollowupCampanha[] | undefined,
): MensagemCampanha[] {
  return mensagemInicial ? [mensagemInicial, ...(followups ?? [])] : (followups ?? [])
}
