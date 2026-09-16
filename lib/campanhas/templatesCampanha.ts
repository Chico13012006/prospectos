import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { referenciasDaCampanha } from '@/lib/templates/referencias'
import { buscarTemplate } from '@/lib/templates/repository'

// Todo vínculo de template no `publico` de uma campanha precisa existir NA
// ORGANIZAÇÃO da campanha. Id de outra organização é tratado exatamente como
// inexistente (404) — e a checagem roda ANTES de qualquer escrita, então uma
// referência estrangeira nunca é gravada nem materializada.

export class ErroTemplateCampanha extends Error {
  readonly status = 404 as const
  constructor() {
    super('Template não encontrado.')
    this.name = 'ErroTemplateCampanha'
  }
}

export async function exigirTemplatesDaOrganizacao(
  admin: SupabaseClient,
  org: string,
  publico: unknown,
): Promise<void> {
  const { ids, origens } = referenciasDaCampanha(publico)
  for (const id of new Set([...ids, ...origens])) {
    const template = await buscarTemplate(admin, org, id)
    if (!template) throw new ErroTemplateCampanha()
    // A origem só pode ser um template de e-mail da biblioteca: é dele que o
    // wizard copia assunto, texto e HTML.
    if (origens.has(id) && !ids.has(id) && template.canal !== 'email') throw new ErroTemplateCampanha()
  }
}
