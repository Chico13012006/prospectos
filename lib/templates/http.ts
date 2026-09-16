import 'server-only'
import { NextResponse } from 'next/server'
import { ErroTemplate, ErroTemplateEmUso } from './repository'

// Tradução dos erros da biblioteca para HTTP. Erro inesperado vira 500 genérico:
// a mensagem do banco fica só no log do servidor.
export function respostaErroTemplate(erro: unknown, contexto: string): NextResponse {
  if (erro instanceof ErroTemplateEmUso) {
    return NextResponse.json({ erro: erro.message, usos: erro.usos }, { status: 409 })
  }
  if (erro instanceof ErroTemplate) return NextResponse.json({ erro: erro.message }, { status: erro.status })
  console.error(`[templates ${contexto}]`, erro)
  return NextResponse.json({ erro: 'Não foi possível processar o template.' }, { status: 500 })
}

export async function lerCorpoJson(
  req: Request,
): Promise<{ ok: true; valor: unknown } | { ok: false; resposta: NextResponse }> {
  try {
    return { ok: true, valor: await req.json() }
  } catch {
    return { ok: false, resposta: NextResponse.json({ erro: 'Corpo da requisição inválido (JSON).' }, { status: 400 }) }
  }
}
