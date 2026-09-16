import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { tiposDeTemplateNaDefinicao } from '@/lib/templates/referencias'

// Publicar (ou retomar) um workflow exige que TODO template referenciado possa
// mesmo ser enviado: existir na organização, estar ativo, ser de e-mail e ter
// conteúdo. Um tipo que só existe em outra organização simplesmente não existe
// aqui — a resposta nunca diz que ele existe em outro lugar.
//
// É também o outro lado da checagem de uso da desativação: se alguém desativou
// o template entre a edição e a publicação, a publicação falha (422) em vez de
// congelar uma versão que não consegue enviar.

// Tipos e textos vivem em lib/templates/problemas.ts (puros, usados também pela
// tela); aqui fica só a consulta ao banco.
export {
  descreverProblemaTemplate,
  mensagemProblemasTemplate,
  type MotivoTemplateInvalido,
  type ProblemaTemplate,
} from '@/lib/templates/problemas'

import type { ProblemaTemplate } from '@/lib/templates/problemas'

interface LinhaTemplateWorkflow {
  tipo: string
  canal: string | null
  ativo: boolean | null
  corpo: string | null
  html: string | null
}

export async function validarTemplatesDaDefinicao(
  admin: SupabaseClient,
  org: string,
  definicao: unknown,
): Promise<ProblemaTemplate[]> {
  const tipos = [...tiposDeTemplateNaDefinicao(definicao)]
  if (tipos.length === 0) return []

  const { data, error } = await admin
    .from('templates')
    .select('tipo, canal, ativo, corpo, html')
    .eq('organizacao_id', org)
    .in('tipo', tipos)
  if (error) throw new Error(error.message)
  const linhas = (data ?? []) as unknown as LinhaTemplateWorkflow[]

  const problemas: ProblemaTemplate[] = []
  for (const tipo of tipos) {
    const doTipo = linhas.filter((linha) => linha.tipo === tipo)
    if (doTipo.length === 0) {
      problemas.push({ template: tipo, motivo: 'ausente' })
      continue
    }
    const deEmail = doTipo.filter((linha) => linha.canal === 'email')
    if (deEmail.length === 0) {
      problemas.push({ template: tipo, motivo: 'canal' })
      continue
    }
    const ativos = deEmail.filter((linha) => linha.ativo === true)
    if (ativos.length === 0) {
      problemas.push({ template: tipo, motivo: 'inativo' })
      continue
    }
    // Basta uma variante utilizável: o envio escolhe entre as ativas.
    if (!ativos.some((linha) => (linha.corpo ?? '').trim() || (linha.html ?? '').trim())) {
      problemas.push({ template: tipo, motivo: 'sem_conteudo' })
    }
  }
  return problemas
}
