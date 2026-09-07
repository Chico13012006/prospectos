import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

// O fim da fila não prova sucesso: execuções podem ter sido canceladas ou
// falhado, e respostas chegam depois do envio. Por isso disparos únicos não são
// mais concluídos automaticamente. A campanha permanece ativa para acompanhamento
// até que um gestor a conclua explicitamente. A função permanece para preservar
// o contrato do executor e evitar uma mudança transversal desnecessária.
export async function concluirDisparoUnicoSeFinalizado(
  _admin: SupabaseClient,
  _organizacaoId: string,
  _campanhaId: string,
): Promise<boolean> {
  return false
}
