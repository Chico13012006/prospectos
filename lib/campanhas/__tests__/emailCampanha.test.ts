import { describe, expect, it } from 'vitest'
import { documentoPreviewHtml, extrairTextoHtmlEmail, montarEmailCampanhaHtml, sanitizarHtmlEmail } from '../emailCampanha'

describe('HTML da mensagem de campanha', () => {
  it('preserva o texto, escapa conteúdo e identifica o responsável no final', () => {
    const html = montarEmailCampanhaHtml('Olá <Ana>\nTudo bem?', {
      responsavelNome: 'Francisco & Equipe',
      nomeServico: 'InovaCode',
    })

    expect(html).toContain('Olá &lt;Ana&gt;<br>Tudo bem?')
    expect(html).toContain('Atenciosamente,')
    expect(html).toContain('Francisco &amp; Equipe')
    expect(html).toContain('InovaCode')
    expect(html).toContain('style="width:100%;max-width:640px')
    expect(html.indexOf('Atenciosamente,')).toBeGreaterThan(html.indexOf('Tudo bem?'))
  })

  it('renderiza HTML personalizado permitido e mantém a assinatura real ao final', () => {
    const html = montarEmailCampanhaHtml('fallback', { responsavelNome: 'Maria' }, '<div style="color:#222"><strong>Olá</strong>, {nome}</div>')

    expect(html).toContain('<strong>Olá</strong>, {nome}')
    expect(html).not.toContain('fallback')
    expect(html).toContain('Maria')
    expect(html.indexOf('Maria')).toBeGreaterThan(html.indexOf('{nome}'))
  })

  it('remove scripts, eventos e protocolos perigosos do HTML importado', () => {
    const html = sanitizarHtmlEmail('<script>alert(1)</script><img src="javascript:alert(1)" onerror="alert(2)"><a href="https://empresa.com" onclick="x()">Seguro</a>')

    expect(html).not.toContain('<script')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('onerror')
    expect(html).not.toContain('onclick')
    expect(html).toContain('href="https://empresa.com"')
  })

  it('gera texto alternativo legível sem CSS ou conteúdo removido', () => {
    const texto = extrairTextoHtmlEmail(`
      <style>.titulo { color: red; }</style>
      <script>alert('não')</script>
      <h1>Olá &amp; bem-vindo</h1>
      <p>Primeira linha<br>Segunda linha</p>
      <ul><li>Item um</li><li>Item dois</li></ul>
    `)

    expect(texto).toBe('Olá & bem-vindo\n\nPrimeira linha\nSegunda linha\n\n• Item um\n\n• Item dois')
    expect(texto).not.toContain('color: red')
    expect(texto).not.toContain('alert')
  })
})

// O HTML passa pela sanitização mais de uma vez no caminho real (editor grava
// sanitizado → montarEmailCampanhaHtml sanitiza → documentoPreviewHtml sanitiza
// de novo na prévia). Antes, cada passagem reescapava os atributos e
// `?a=1&b=2` virava `?a=1&amp;amp;b=2` — link quebrado no e-mail enviado.
describe('sanitização idempotente', () => {
  const casos: [string, string][] = [
    ['link com query string', '<a href="https://art.com.br/renovar?a=1&b=2&utm=campanha">Renovar</a>'],
    ['link já escapado', '<a href="https://art.com.br/renovar?a=1&amp;b=2">Renovar</a>'],
    ['mailto com assunto', '<a href="mailto:contato@art.com.br?subject=Renova%C3%A7%C3%A3o&body=Ol%C3%A1">Escrever</a>'],
    ['imagem com atributos permitidos', '<img src="https://cdn.art.com.br/logo.png?v=2&x=1" alt="Logo &quot;ART&quot;" width="120" />'],
    ['acentos e entidade numérica', '<p title="Validade &#233; 30/09">Renovação — laudo técnico &amp; anexos</p>'],
    ['tabela com estilo inline', '<table role="presentation" style="width:100%;border:1px solid #e5e7eb"><tr><td align="left">Olá</td></tr></table>'],
    ['âncora interna', '<a href="#topo">Voltar ao topo</a>'],
  ]

  it.each(casos)('%s: sanitizar duas vezes dá o mesmo resultado', (_nome, html) => {
    const uma = sanitizarHtmlEmail(html)
    expect(sanitizarHtmlEmail(uma)).toBe(uma)
    expect(sanitizarHtmlEmail(sanitizarHtmlEmail(uma))).toBe(uma)
  })

  it('preserva a query string do link em qualquer número de passagens', () => {
    const uma = sanitizarHtmlEmail('<a href="https://art.com.br/r?a=1&b=2">x</a>')
    expect(uma).toContain('href="https://art.com.br/r?a=1&amp;b=2"')
    expect(sanitizarHtmlEmail(uma)).not.toContain('&amp;amp;')
  })

  it('o caminho real (editor → envio → prévia) não acumula escape', () => {
    const doEditor = sanitizarHtmlEmail('<a href="https://art.com.br/r?a=1&b=2">Renovar</a>')
    const enviado = montarEmailCampanhaHtml('Renovar', { responsavelNome: 'Aline' }, doEditor)
    const previa = documentoPreviewHtml(enviado)
    for (const saida of [enviado, previa]) {
      expect(saida).toContain('href="https://art.com.br/r?a=1&amp;b=2"')
      expect(saida).not.toContain('&amp;amp;')
    }
  })

  it('continua bloqueando script, eventos e URL disfarçada por entidade', () => {
    const html = sanitizarHtmlEmail(
      '<script>alert(1)</script><a href="&#106;avascript:alert(1)" onclick="x()">a</a>' +
      '<img src="javascript:alert(1)" onerror="y()"><p style="background:url(javascript:z)">t</p>',
    )
    expect(html).not.toMatch(/<script|onclick|onerror|javascript:/i)
    expect(html).not.toContain('href=')
    expect(html).not.toContain('src=')
    expect(sanitizarHtmlEmail(html)).toBe(html)
  })

  it('texto alternativo é o mesmo depois de passagens repetidas', () => {
    const html = '<p>Olá &amp; bem-vindo — <a href="https://x.com/?a=1&b=2">link</a></p>'
    const uma = extrairTextoHtmlEmail(sanitizarHtmlEmail(html))
    expect(extrairTextoHtmlEmail(sanitizarHtmlEmail(sanitizarHtmlEmail(html)))).toBe(uma)
    expect(uma).toContain('Olá & bem-vindo')
  })
})
