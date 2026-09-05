// Separa o que o usuário autorou do que a campanha gerou por baixo.
//
// Ativar uma campanha materializa um workflow ("Campanha — <nome>") e um
// template por mensagem ("campanha_<id>_m1"). São artefatos internos: o motor
// depende deles, mas o usuário nunca os escreveu e não deveria gerenciá-los.
// Sem este filtro, as listas de Workflows e Templates crescem uma linha por
// campanha para sempre — na org de laudos já eram 12 de 16 workflows e 17 de 27
// templates.
//
// Puro e sem I/O. O filtro vale só para LISTAGENS de interface; o motor segue
// enxergando tudo (ver workflowsPublicados no store).

// Prefixo do `tipo` dos templates materializados pelo wizard de campanha.
const PREFIXO_TEMPLATE_CAMPANHA = 'campanha_'

export interface ItemComId {
  id: string
}

/**
 * Remove os workflows que pertencem a alguma campanha. `idsDeCampanha` vem de
 * `campanhas.workflow_id` — vínculo real, não heurística de nome (uma campanha
 * pode ser renomeada, e um workflow autoral pode se chamar "Campanha — algo").
 */
export function apenasWorkflowsAutorais<T extends ItemComId>(
  workflows: T[],
  idsDeCampanha: Iterable<string>,
): T[] {
  const gerados = new Set(idsDeCampanha)
  return workflows.filter((wf) => !gerados.has(wf.id))
}

/** Um template materializado por campanha? Reconhecido pelo `tipo`. */
export function ehTemplateDeCampanha(tipo: unknown): boolean {
  return typeof tipo === 'string' && tipo.startsWith(PREFIXO_TEMPLATE_CAMPANHA)
}

/** Remove da biblioteca os templates gerados por campanhas. */
export function apenasTemplatesAutorais<T extends { tipo?: unknown }>(templates: T[]): T[] {
  return templates.filter((t) => !ehTemplateDeCampanha(t.tipo))
}
