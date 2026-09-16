// Problemas de template numa definição de workflow — tipos e textos PUROS
// (client-safe). A validação que os produz é server-only
// (lib/workflows/validarTemplates.ts); a tela reaproveita estes rótulos para
// avisar sem duplicar vocabulário.

export type MotivoTemplateInvalido = 'ausente' | 'inativo' | 'canal' | 'sem_conteudo'

export interface ProblemaTemplate {
  template: string
  motivo: MotivoTemplateInvalido
}

const MENSAGEM: Record<MotivoTemplateInvalido, string> = {
  ausente: 'não existe na biblioteca desta organização',
  inativo: 'está desativado',
  canal: 'não é um template de e-mail',
  sem_conteudo: 'está sem conteúdo',
}

export function descreverProblemaTemplate(problema: ProblemaTemplate): string {
  return `"${problema.template}" ${MENSAGEM[problema.motivo]}`
}

export function mensagemProblemasTemplate(
  problemas: readonly ProblemaTemplate[],
  acao: 'publicar' | 'retomar' | 'ativar' = 'publicar',
): string {
  return `Não foi possível ${acao}: ${problemas.map(descreverProblemaTemplate).join('; ')}.`
}
