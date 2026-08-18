import { describe, expect, it } from 'vitest'
import { montarEmailCampanhaHtml, sanitizarHtmlEmail } from '../emailCampanha'

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
})
