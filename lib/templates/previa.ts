// Prévia de um template com dados de exemplo.
//
// Usa EXATAMENTE o caminho do envio real — `preencher` (lib/engine/mensagem.ts)
// para as variáveis e `montarEmailCampanhaHtml` para o HTML —, então a tela não
// mostra nada diferente do que sai para o cliente. Puro: não grava, não envia,
// não cria interação e não conhece rede.
import { montarEmailCampanhaHtml } from '@/lib/campanhas/emailCampanha'
import { VARIAVEIS_MENSAGEM_CAMPANHA } from '@/lib/campanhas/edicaoMensagens'
import { preencher } from '@/lib/engine/mensagem'
import type { Lead } from '@/lib/engine/types'
import { exigeReuniao, VARIAVEIS_REUNIAO } from '@/lib/pipeline/mensagemEtapa'
import type { TemplateBiblioteca } from './tipos'

// As variáveis que o renderizador do envio realmente substitui.
export const VARIAVEIS_TEMPLATE = VARIAVEIS_MENSAGEM_CAMPANHA

// A mensagem de Reunião Agendada (chave `reuniao_agendada`, enviada pelo
// "Mover e enviar" do Kanban) também tem a data e a hora da reunião.
export function variaveisDoTemplate(tipo: string | null | undefined): readonly string[] {
  return tipo && exigeReuniao(tipo) ? [...VARIAVEIS_TEMPLATE, ...VARIAVEIS_REUNIAO] : VARIAVEIS_TEMPLATE
}

const REUNIAO_EXEMPLO = { data_reuniao: '30/09/2026', hora_reuniao: '14:00' }

// Lead fictício: nenhum dado real de cliente aparece na prévia.
const RESPONSAVEL_EXEMPLO = 'Aline'
const NOME_SERVICO_EXEMPLO = 'Laudo Técnico'
const LEAD_EXEMPLO = {
  id: 'exemplo',
  empresa: 'Empresa Exemplo',
  contato_nome: 'Maria Souza',
  contato_email: 'maria@empresaexemplo.com.br',
  segmento: 'Hotelaria',
  cidade: 'São Paulo',
  responsavel_nome: RESPONSAVEL_EXEMPLO,
  data_validade: '2026-09-30',
} as unknown as Lead

export interface PreviaTemplate {
  assunto: string
  texto: string
  // Só e-mail tem HTML; WhatsApp e demais canais são texto puro.
  html: string | null
}

export function previaTemplate(
  template: Pick<TemplateBiblioteca, 'canal' | 'assunto' | 'corpo' | 'html'> & { tipo?: string | null },
): PreviaTemplate {
  const extras = {
    nome_servico: NOME_SERVICO_EXEMPLO,
    ...(template.tipo && exigeReuniao(template.tipo) ? REUNIAO_EXEMPLO : {}),
  }
  const assunto = preencher(template.assunto ?? '', LEAD_EXEMPLO, extras)
  const texto = preencher(template.corpo ?? '', LEAD_EXEMPLO, extras)
  if (template.canal !== 'email') return { assunto: '', texto, html: null }
  const htmlPersonalizado = template.html ? preencher(template.html, LEAD_EXEMPLO, extras) : undefined
  return {
    assunto,
    texto,
    html: montarEmailCampanhaHtml(
      texto,
      { responsavelNome: RESPONSAVEL_EXEMPLO, nomeServico: NOME_SERVICO_EXEMPLO },
      htmlPersonalizado,
    ),
  }
}
