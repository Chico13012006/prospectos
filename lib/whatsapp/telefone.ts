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

// Quirk do "9º dígito" do celular BR: a mesma linha pode aparecer com 11
// dígitos locais (DDD + 9 + assinante de 8) ou com 10 (DDD + assinante de 8,
// formato antigo) dependendo da origem do dado — foi o que aconteceu com um
// ReceivedCallback real da Z-API, que entregou o remetente SEM o 9 enquanto
// `leads.contato_telefone` guardava COM o 9, deixando a mensagem sem vínculo.
// Gera a forma alternativa (insere/remove o 9 logo após o DDD); null quando o
// comprimento não permite a transformação.
function comNoveAlternativo(local: string): string | null {
  if (local.length === 11 && local[2] === '9') return local.slice(0, 2) + local.slice(3)
  if (local.length === 10) return local.slice(0, 2) + '9' + local.slice(2)
  return null
}

// Expande uma lista de variantes (já com/sem DDI) somando a forma alternativa
// do 9º dígito de cada uma, com e sem DDI.
function comVariantesDoNove(variantes: string[]): Set<string> {
  const out = new Set(variantes)
  for (const v of variantes) {
    const local = v.startsWith(DDI_BR) && ehLocalBr(v.slice(2)) ? v.slice(2) : ehLocalBr(v) ? v : null
    if (!local) continue
    const alt = comNoveAlternativo(local)
    if (alt) {
      out.add(alt)
      out.add(DDI_BR + alt)
    }
  }
  return out
}

/**
 * `true` se os dois números representam o MESMO telefone brasileiro, ignorando
 * a presença/ausência do DDI 55, do 9º dígito do celular e qualquer máscara.
 * Simétrica.
 *
 * A comparação é por interseção dos conjuntos de variantes (DDI + 9º dígito)
 * — não há comparação por sufixo nem "contém", justamente para não casar
 * números diferentes que compartilham um final.
 */
export function telefonesEquivalentes(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const va = variantesTelefoneBr(normalizarTelefone(a))
  if (va.length === 0) return false
  const vb = variantesTelefoneBr(normalizarTelefone(b))
  if (vb.length === 0) return false
  const setA = comVariantesDoNove(va)
  const setB = comVariantesDoNove(vb)
  for (const v of setA) if (setB.has(v)) return true
  return false
}
