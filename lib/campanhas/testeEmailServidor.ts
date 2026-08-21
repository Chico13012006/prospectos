import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { engineConfig } from '@/lib/engine/config'
import { GmailProvider, lerCredenciaisGmail } from '@/lib/engine/email/gmailProvider'
import { LIMITE_HTML_CAMPANHA } from './configuracaoGuiada'
import { montarEmailCampanhaHtml } from './emailCampanha'
import { buscarRemetenteCampanha } from './opcoesServidor'

const LIMITE_ASSUNTO_TESTE = 200
const LIMITE_CORPO_TESTE = 50_000

export interface DadosTesteEmailCampanha {
  assunto?: unknown
  corpo?: unknown
  html?: unknown
  responsavelNome?: unknown
}

function textoObrigatorio(valor: unknown, campo: string, limite: number): string {
  if (typeof valor !== 'string' || !valor.trim()) throw new Error(`Informe ${campo}.`)
  const texto = valor.trim()
  if (texto.length > limite) throw new Error(`${campo} excede o limite de ${limite} caracteres.`)
  return texto
}

function textoOpcional(valor: unknown, limite: number, campo: string): string | undefined {
  if (typeof valor !== 'string' || !valor.trim()) return undefined
  const texto = valor.trim()
  if (texto.length > limite) throw new Error(`${campo} excede o limite permitido.`)
  return texto
}

// Envio deliberadamente restrito à própria conta remetente do workspace. Não
// aceita destinatário do cliente, não persiste campanha e não cria execução.
// A trava global MODO_ENSAIO continua soberana e nunca é contornada pelo teste.
export async function enviarTesteEmailCampanha(
  admin: SupabaseClient,
  org: string,
  dados: DadosTesteEmailCampanha,
): Promise<{ destinatario: string; assunto: string }> {
  const assunto = textoObrigatorio(dados.assunto, 'o assunto da mensagem', LIMITE_ASSUNTO_TESTE)
  const corpo = textoObrigatorio(dados.corpo, 'o conteúdo da mensagem', LIMITE_CORPO_TESTE)
  const html = textoOpcional(dados.html, LIMITE_HTML_CAMPANHA, 'O HTML da mensagem')
  const responsavelNome = textoOpcional(dados.responsavelNome, 200, 'O nome do responsável')

  if (engineConfig.modoEnsaio) {
    throw new Error('O motor está em modo ensaio; nenhum e-mail de teste foi enviado.')
  }

  const remetente = await buscarRemetenteCampanha(admin, org)
  if (!remetente) throw new Error('Configure uma conta remetente no workspace antes de enviar o teste.')

  const credenciais = lerCredenciaisGmail(remetente.conta)
  if (!credenciais || credenciais.user.toLowerCase() !== remetente.email.toLowerCase()) {
    throw new Error('As credenciais da conta remetente não estão disponíveis.')
  }

  const assuntoTeste = `[TESTE] ${assunto}`
  const htmlFinal = montarEmailCampanhaHtml(corpo, { responsavelNome }, html)
  await new GmailProvider(credenciais).enviar(remetente.email, assuntoTeste, corpo, htmlFinal)

  return { destinatario: remetente.email, assunto: assuntoTeste }
}
