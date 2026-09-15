import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { aplicarEdicaoMensagens, motivoBloqueioEdicaoMensagens, rotuloMensagem } from './edicaoMensagens'

// Grava a edição de mensagens de uma campanha publicada. O envio lê assunto e
// texto da tabela `templates` (pelo templateTipo materializado) e o HTML do
// `publico` da campanha — por isso os dois lados são atualizados. service_role
// ignora RLS: toda leitura e escrita filtra organizacao_id.
//
// Tudo é validado e todos os templates são localizados ANTES da primeira
// escrita. Se a gravação do público falhar depois dos templates, repetir a
// mesma edição regrava os dois lados.

export class ErroEdicaoMensagens extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409) {
    super(message)
    this.name = 'ErroEdicaoMensagens'
  }
}

export async function editarMensagensCampanha(
  admin: SupabaseClient,
  org: string,
  campanhaId: string,
  edicao: unknown,
): Promise<{ mensagens: number }> {
  const { data: campanha, error } = await admin
    .from('campanhas')
    .select('id, status, publico')
    .eq('organizacao_id', org)
    .eq('id', campanhaId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!campanha) throw new ErroEdicaoMensagens('Campanha não encontrada.', 404)

  const bloqueio = motivoBloqueioEdicaoMensagens(campanha.status as string)
  if (bloqueio) throw new ErroEdicaoMensagens(bloqueio, 409)

  let resultado: ReturnType<typeof aplicarEdicaoMensagens>
  try {
    resultado = aplicarEdicaoMensagens(campanha.publico, edicao)
  } catch (e) {
    throw new ErroEdicaoMensagens(e instanceof Error ? e.message : 'Edição inválida.', 400)
  }

  for (const template of resultado.templates) {
    const { data: existentes, error: erroBusca } = await admin
      .from('templates')
      .select('id')
      .eq('organizacao_id', org)
      .eq('canal', 'email')
      .eq('tipo', template.templateTipo)
      .is('nicho', null)
      .limit(1)
    if (erroBusca) throw new Error(erroBusca.message)
    if (!existentes?.length) {
      throw new ErroEdicaoMensagens(`O template ${rotuloMensagem(template.indice)} não foi encontrado.`, 409)
    }
  }

  for (const template of resultado.templates) {
    const { error: erroTemplate } = await admin
      .from('templates')
      .update({ assunto: template.assunto, corpo: template.corpo })
      .eq('organizacao_id', org)
      .eq('canal', 'email')
      .eq('tipo', template.templateTipo)
      .is('nicho', null)
    if (erroTemplate) throw new Error(erroTemplate.message)
  }

  const { error: erroCampanha } = await admin
    .from('campanhas')
    .update({ publico: resultado.publico })
    .eq('organizacao_id', org)
    .eq('id', campanhaId)
  if (erroCampanha) throw new Error(erroCampanha.message)

  return { mensagens: resultado.templates.length }
}
