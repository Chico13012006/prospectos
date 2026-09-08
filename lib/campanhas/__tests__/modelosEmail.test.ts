import { describe, expect, it } from 'vitest'
import { MODELOS_EMAIL, montarModeloEmail, textoModeloEmail } from '../modelosEmail'
import { sanitizarHtmlEmail, extrairTextoHtmlEmail } from '../emailCampanha'

const completo = {
  etiqueta: 'novidade',
  titulo: 'Chegou o novo coletor',
  paragrafos: 'Primeiro parágrafo.\n\nSegundo parágrafo,\ncom quebra simples.',
  ctaTexto: 'Ver detalhes',
  ctaLink: 'https://prospectos.com.br/novidade',
  encerramento: 'Qualquer dúvida, é só responder.',
}

describe('modelos de e-mail', () => {
  it('todo modelo sobrevive à sanitização sem perder o conteúdo', () => {
    for (const modelo of MODELOS_EMAIL) {
      const html = montarModeloEmail(modelo.id, completo)
      const sanitizado = sanitizarHtmlEmail(html)
      const texto = extrairTextoHtmlEmail(sanitizado)

      expect(texto).toContain('Chegou o novo coletor')
      expect(texto).toContain('Primeiro parágrafo.')
      expect(texto).toContain('Ver detalhes')
      expect(sanitizado).toContain('https://prospectos.com.br/novidade')
      // A etiqueta é normalizada para caixa alta na apresentação.
      expect(sanitizado).toContain('NOVIDADE')
    }
  })

  it('separa parágrafos por linha em branco e preserva a quebra simples', () => {
    // Sem encerramento: assim os <p> contados são só os do corpo.
    const html = montarModeloEmail('comunicado', { ...completo, encerramento: undefined })
    expect(html.match(/<p /g) ?? []).toHaveLength(2)
    expect(html).toContain('Segundo parágrafo,<br />com quebra simples.')
    // Com encerramento entra mais um parágrafo, e só ele.
    expect(montarModeloEmail('comunicado', completo).match(/<p /g) ?? []).toHaveLength(3)
  })

  it('campo vazio não vira placeholder no e-mail do cliente', () => {
    const html = montarModeloEmail('comunicado', { paragrafos: 'Só isso.' })
    expect(html).not.toContain('<h1')
    expect(html).not.toContain('não configurado')
    expect(html).not.toContain('undefined')
    expect(html).toContain('Só isso.')
  })

  it('descarta link que não seja http(s) em vez de gerar href quebrado', () => {
    for (const link of ['javascript:alert(1)', 'data:text/html,<b>x', 'sem-protocolo', '']) {
      const html = montarModeloEmail('novidade', { ctaTexto: 'Clique', ctaLink: link })
      expect(html).not.toContain('Clique')
      expect(html).not.toContain('href')
    }
  })

  it('escapa conteúdo do usuário — título com HTML não vira marcação', () => {
    const html = montarModeloEmail('comunicado', {
      titulo: '<script>alert(1)</script> & "aspas"',
      paragrafos: '<b>negrito falso</b>',
    })
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<b>negrito falso</b>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('imagem só entra com URL http(s)', () => {
    expect(montarModeloEmail('novidade', { imagemUrl: 'https://cdn.exemplo.com/a.png' }))
      .toContain('src="https://cdn.exemplo.com/a.png"')
    expect(montarModeloEmail('novidade', { imagemUrl: 'javascript:alert(1)' })).not.toContain('<img')
  })

  it('modelo desconhecido cai no primeiro em vez de quebrar', () => {
    expect(montarModeloEmail('inexistente', { titulo: 'Oi' })).toContain('Oi')
  })

  it('texto puro acompanha o HTML, com o link ao lado do rótulo', () => {
    const texto = textoModeloEmail(completo)
    expect(texto).toContain('Chegou o novo coletor')
    expect(texto).toContain('Ver detalhes: https://prospectos.com.br/novidade')
    expect(texto).toContain('Qualquer dúvida')
  })
})
