// Normalização e comparação de telefones para vincular mensagem inbound do
// WhatsApp a um lead. Funções PURAS e determinísticas — sem I/O, sem estado —
// para poderem ser testadas isoladamente (requisito da spec).
//
// Contexto do dado:
//   * A Meta entrega o remetente em E.164 sem '+', sempre com DDI (Brasil = 55):
//     ex. "5511991532368".
//   * A base de leads (`leads.contato_telefone`) é heterogênea: número local sem
//     DDI ("11991532368"), com DDI, com "+", e ainda lixo concatenado de
//     importações antigas. Só casamos o que dá para reconhecer como telefone
//     brasileiro; o resto não casa com nada (nunca match parcial "por sorte").

const DDI_BR = '55'

// Comprimento de um número BR local (DDD + assinante), sem DDI:
//   10 = DDD (2) + fixo (8)
//   11 = DDD (2) + celular (9)
function ehLocalBr(digitos: string): boolean {
  return digitos.length === 10 || digitos.length === 11
}

/** Remove tudo que não for dígito. `null`/`undefined` viram string vazia. */
export function normalizarTelefone(bruto: string | null | undefined): string {
  return (bruto ?? '').replace(/\D+/g, '')
}

/**
 * Formas comparáveis de um telefone brasileiro: a com DDI e a sem. Determinística.
 *
 *   "11991532368"    -> ["11991532368", "5511991532368"]
 *   "5511991532368"  -> ["5511991532368", "11991532368"]
 *   "551132390777"   -> ["551132390777", "1132390777"]   (fixo, 55 + 10)
 *   "998877"         -> []   (curto demais — não é telefone reconhecível)
 *   "2196902361521979393105" -> []   (lixo concatenado — não casa com nada)
 *
 * O array vazio é intencional: quem não é reconhecível como telefone BR não
 * pode gerar vínculo.
 */
export function variantesTelefoneBr(digitos: string): string[] {
  if (ehLocalBr(digitos)) return [digitos, DDI_BR + digitos]
  if (digitos.startsWith(DDI_BR) && ehLocalBr(digitos.slice(2))) {
    return [digitos, digitos.slice(2)]
  }
  return []
}

/**
 * `true` se os dois números representam o MESMO telefone brasileiro, ignorando
 * a presença/ausência do DDI 55 e qualquer máscara. Simétrica.
 *
 * A comparação é por interseção exata dos conjuntos de variantes — não há
 * comparação por sufixo nem "contém", justamente para não casar números
 * diferentes que compartilham um final.
 */
export function telefonesEquivalentes(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const va = variantesTelefoneBr(normalizarTelefone(a))
  if (va.length === 0) return false
  const vb = new Set(variantesTelefoneBr(normalizarTelefone(b)))
  return va.some((v) => vb.has(v))
}
