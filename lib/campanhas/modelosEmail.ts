// Modelos de e-mail prontos: o layout é fixo e testado, e só o CONTEÚDO muda.
//
// Por que existe: montar HTML de e-mail à mão (ou pedir a uma IA que o gere
// inteiro toda vez) produz um layout diferente a cada comunicado e quebra fácil
// em Outlook/Gmail. Aqui a marcação é escrita uma vez, com tabela e estilo
// inline — o resto do mundo é que precisa se encaixar nela.
//
// Gera apenas o MIOLO do e-mail. O cartão externo, a largura e a assinatura vêm
// de `montarEmailCampanhaHtml`, e o resultado passa por `sanitizarHtmlEmail`
// antes de ir para a prévia ou para o envio — por isso só usamos tags e
// atributos da allowlist (table/tr/td/div/p/h1/a/img/span/strong + style).
//
// Puro e sem I/O: a mesma função monta a prévia na tela e o HTML materializado.

import { escaparHtmlEmail } from './emailCampanha'

export interface CamposModeloEmail {
  /** Rótulo curto acima do título: NOVIDADE, COMUNICADO, AVISO… */
  etiqueta?: string
  titulo?: string
  /** Texto corrido. Linha em branco separa parágrafos. */
  paragrafos?: string
  ctaTexto?: string
  ctaLink?: string
  /** URL de imagem (opcional). Só http(s) — a sanitização derruba o resto. */
  imagemUrl?: string
  /** Fecho curto acima da assinatura automática. */
  encerramento?: string
}

export interface ModeloEmail {
  id: string
  nome: string
  descricao: string
  /** Sugestão de etiqueta ao escolher o modelo — o usuário pode trocar. */
  etiquetaPadrao: string
  cor: string
}

export const MODELOS_EMAIL: ModeloEmail[] = [
  {
    id: 'novidade',
    nome: 'Novidade',
    descricao: 'Anunciar funcionalidade, produto ou equipamento novo. Destaque colorido e botão.',
    etiquetaPadrao: 'NOVIDADE',
    cor: '#4f46e5',
  },
  {
    id: 'comunicado',
    nome: 'Comunicado',
    descricao: 'Informar mudança de funcionamento, processo ou condição comercial. Sóbrio.',
    etiquetaPadrao: 'COMUNICADO',
    cor: '#0f172a',
  },
  {
    id: 'aviso',
    nome: 'Aviso importante',
    descricao: 'Prazo, vencimento ou pendência. O conteúdo vai numa faixa de atenção.',
    etiquetaPadrao: 'AVISO',
    cor: '#b45309',
  },
]

export function buscarModeloEmail(id: string | null | undefined): ModeloEmail | null {
  return MODELOS_EMAIL.find((modelo) => modelo.id === id) ?? null
}

// http(s) apenas. Link inválido some do resultado em vez de virar href quebrado.
function linkSeguro(valor: string | undefined): string | null {
  const bruto = valor?.trim()
  if (!bruto) return null
  try {
    const url = new URL(bruto)
    return url.protocol === 'https:' || url.protocol === 'http:' ? bruto : null
  } catch {
    return null
  }
}

function paragrafosHtml(texto: string | undefined, cor: string): string {
  const blocos = (texto ?? '')
    .split(/\n\s*\n/)
    .map((bloco) => bloco.trim())
    .filter(Boolean)
  if (!blocos.length) return ''
  return blocos
    .map((bloco) => {
      // Quebra simples dentro do parágrafo vira <br>, como o autor escreveu.
      const corpo = escaparHtmlEmail(bloco).replace(/\r?\n/g, '<br />')
      return `<p style="margin:0 0 16px 0;color:${cor};font-size:15px;line-height:1.65;">${corpo}</p>`
    })
    .join('\n')
}

function botaoHtml(campos: CamposModeloEmail, cor: string): string {
  const link = linkSeguro(campos.ctaLink)
  const rotulo = campos.ctaTexto?.trim()
  if (!link || !rotulo) return ''
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 4px 0;">
  <tr><td bgcolor="${cor}" style="background-color:${cor};border-radius:8px;">
    <a href="${escaparHtmlEmail(link)}" target="_blank" style="display:inline-block;padding:13px 26px;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none;">${escaparHtmlEmail(rotulo)}</a>
  </td></tr>
</table>`
}

function imagemHtml(campos: CamposModeloEmail): string {
  const src = linkSeguro(campos.imagemUrl)
  if (!src) return ''
  return `<img src="${escaparHtmlEmail(src)}" alt="${escaparHtmlEmail(campos.titulo?.trim() ?? '')}" width="100%" style="width:100%;max-width:560px;border-radius:10px;margin:0 0 20px 0;" />`
}

function etiquetaHtml(campos: CamposModeloEmail, modelo: ModeloEmail, fundo: string, texto: string): string {
  const rotulo = (campos.etiqueta?.trim() || modelo.etiquetaPadrao).toUpperCase()
  if (!rotulo) return ''
  return `<span style="display:inline-block;padding:5px 12px;background-color:${fundo};color:${texto};border-radius:999px;font-size:11px;font-weight:bold;letter-spacing:1px;">${escaparHtmlEmail(rotulo)}</span>`
}

function tituloHtml(campos: CamposModeloEmail, cor: string): string {
  const titulo = campos.titulo?.trim()
  if (!titulo) return ''
  return `<h1 style="margin:14px 0 18px 0;color:${cor};font-size:24px;line-height:1.3;font-weight:bold;">${escaparHtmlEmail(titulo)}</h1>`
}

function encerramentoHtml(campos: CamposModeloEmail): string {
  const texto = campos.encerramento?.trim()
  if (!texto) return ''
  return `<p style="margin:22px 0 0 0;color:#64748b;font-size:14px;line-height:1.6;">${escaparHtmlEmail(texto).replace(/\r?\n/g, '<br />')}</p>`
}

/**
 * Monta o miolo do e-mail para o modelo escolhido. Campo vazio simplesmente não
 * aparece — nada de "título não configurado" chegando ao cliente.
 */
export function montarModeloEmail(modeloId: string, campos: CamposModeloEmail): string {
  const modelo = buscarModeloEmail(modeloId) ?? MODELOS_EMAIL[0]

  if (modelo.id === 'aviso') {
    return `<div>
  ${etiquetaHtml(campos, modelo, '#fef3c7', '#92400e')}
  ${tituloHtml(campos, '#0f172a')}
  ${imagemHtml(campos)}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background-color:#fffbeb;border-radius:10px;">
    <tr><td style="padding:18px 20px;border-left:4px solid #f59e0b;">
      ${paragrafosHtml(campos.paragrafos, '#7c2d12') || '<p style="margin:0;color:#7c2d12;font-size:15px;">&nbsp;</p>'}
    </td></tr>
  </table>
  <div style="margin-top:20px;">${botaoHtml(campos, '#b45309')}</div>
  ${encerramentoHtml(campos)}
</div>`
  }

  if (modelo.id === 'comunicado') {
    return `<div>
  ${etiquetaHtml(campos, modelo, '#e2e8f0', '#0f172a')}
  ${tituloHtml(campos, '#0f172a')}
  ${imagemHtml(campos)}
  ${paragrafosHtml(campos.paragrafos, '#334155')}
  ${botaoHtml(campos, '#0f172a')}
  ${encerramentoHtml(campos)}
</div>`
  }

  // 'novidade' — o padrão, com faixa de destaque no topo.
  return `<div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background-color:#4f46e5;border-radius:10px;margin:0 0 22px 0;">
    <tr><td style="padding:20px 22px;">
      ${etiquetaHtml(campos, modelo, '#ffffff', '#4338ca')}
      ${campos.titulo?.trim()
        ? `<div style="margin-top:12px;color:#ffffff;font-size:22px;line-height:1.3;font-weight:bold;">${escaparHtmlEmail(campos.titulo.trim())}</div>`
        : ''}
    </td></tr>
  </table>
  ${imagemHtml(campos)}
  ${paragrafosHtml(campos.paragrafos, '#334155')}
  ${botaoHtml(campos, '#4f46e5')}
  ${encerramentoHtml(campos)}
</div>`
}

/** Texto puro equivalente, para o fallback de quem lê e-mail sem HTML. */
export function textoModeloEmail(campos: CamposModeloEmail): string {
  const partes = [
    campos.titulo?.trim(),
    campos.paragrafos?.trim(),
    campos.ctaTexto?.trim() && linkSeguro(campos.ctaLink)
      ? `${campos.ctaTexto.trim()}: ${campos.ctaLink?.trim()}`
      : linkSeguro(campos.ctaLink),
    campos.encerramento?.trim(),
  ].filter(Boolean)
  return partes.join('\n\n')
}
