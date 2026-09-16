// Onde um template de e-mail é referenciado, lido das estruturas persistidas.
// Puro: serve à checagem de uso antes de desativar e à validação de publicação.

const objeto = (valor: unknown): Record<string, unknown> =>
  valor && typeof valor === 'object' && !Array.isArray(valor) ? valor as Record<string, unknown> : {}

// Tipos de template que uma definição de workflow envia. Espelha acaoEnviarEmail
// (lib/workflows/blocos.ts): sem `template`, o bloco usa `tipo` e, na falta dos
// dois, 'follow_up_1'. O `ramificar` legado aninha ações em `entao`/`senao`.
export function tiposDeTemplateNaDefinicao(definicao: unknown): Set<string> {
  const tipos = new Set<string>()
  const visitar = (blocos: unknown) => {
    if (!Array.isArray(blocos)) return
    for (const bruto of blocos) {
      const bloco = objeto(bruto)
      const config = objeto(bloco.config)
      if (bloco.tipo === 'enviar_email') tipos.add(String(config.template ?? config.tipo ?? 'follow_up_1'))
      visitar(config.entao)
      visitar(config.senao)
    }
  }
  visitar(objeto(definicao).acoes)
  return tipos
}

// Vínculos de template das mensagens de uma campanha (inicial + follow-ups).
// `ids`/`tipos` são o que a campanha ENVIA (a cópia materializada); `origens`
// é só a procedência (`templateOrigemId`), cujo conteúdo já foi copiado. Por
// isso a checagem de uso ignora `origens` — mas a validação de gravação não:
// nenhuma referência estrangeira pode ser persistida.
export function referenciasDaCampanha(publico: unknown): { ids: Set<string>; tipos: Set<string>; origens: Set<string> } {
  const ids = new Set<string>()
  const tipos = new Set<string>()
  const origens = new Set<string>()
  const operacao = objeto(objeto(publico).operacao)
  const followups = Array.isArray(operacao.followups) ? operacao.followups : []
  for (const bruta of [operacao.mensagemInicial, ...followups]) {
    const mensagem = objeto(bruta)
    if (typeof mensagem.templateId === 'string' && mensagem.templateId) ids.add(mensagem.templateId)
    if (typeof mensagem.templateTipo === 'string' && mensagem.templateTipo) tipos.add(mensagem.templateTipo)
    if (typeof mensagem.templateOrigemId === 'string' && mensagem.templateOrigemId) origens.add(mensagem.templateOrigemId)
  }
  return { ids, tipos, origens }
}
