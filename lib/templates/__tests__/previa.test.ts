// Prévia do template: mesmos dados de exemplo para todo mundo, o mesmo
// renderizador do envio e nenhum efeito (não grava, não envia, não usa rede).
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { VARIAVEIS_MENSAGEM_CAMPANHA } from '@/lib/campanhas/edicaoMensagens'
import { VARIAVEIS_TEMPLATE, previaTemplate } from '../previa'

const TODAS = `{{nome}} | {{empresa}} | {{segmento}} | {{cidade}} | {{responsavel_comercial}} | {{data_validade}} | {{nome_servico}}`

describe('variáveis da prévia', () => {
  it('são exatamente as que o envio substitui — nenhuma inventada', () => {
    expect([...VARIAVEIS_TEMPLATE]).toEqual([...VARIAVEIS_MENSAGEM_CAMPANHA])
  })

  it('todas são preenchidas com o exemplo, sem sobrar chave', () => {
    const { texto } = previaTemplate({ canal: 'email', assunto: '', corpo: TODAS, html: null })
    expect(texto).toBe('Maria | Empresa Exemplo | Hotelaria | São Paulo | Aline | 30/09/2026 | Laudo Técnico')
    expect(texto).not.toMatch(/\{\{?\w+\}?\}/)
  })

  it('aceita chave simples e dupla, como o envio', () => {
    const { texto } = previaTemplate({ canal: 'email', assunto: '', corpo: 'Olá {nome} da {{empresa}}', html: null })
    expect(texto).toBe('Olá Maria da Empresa Exemplo')
  })

  it('nunca mostra undefined, null ou [object Object]', () => {
    const casos = [
      { canal: 'email' as const, assunto: '', corpo: '', html: null },
      { canal: 'email' as const, assunto: '{{data_validade}}', corpo: TODAS, html: `<p>${TODAS}</p>` },
      { canal: 'whatsapp' as const, assunto: null, corpo: 'Oi {{nome}}, sobre {{nome_servico}}', html: null },
      { canal: 'email' as const, assunto: '{{desconhecida}}', corpo: '{{tambem_desconhecida}}', html: null },
    ]
    for (const caso of casos) {
      const previa = previaTemplate(caso)
      const tudo = `${previa.assunto}|${previa.texto}|${previa.html ?? ''}`
      expect(tudo).not.toMatch(/undefined|null|\[object Object\]/)
    }
  })

  it('variável desconhecida continua literal (não vira vazio nem undefined)', () => {
    const { texto } = previaTemplate({ canal: 'email', assunto: '', corpo: 'Oi {{fulano}}', html: null })
    expect(texto).toBe('Oi {{fulano}}')
  })
})

describe('prévia por canal', () => {
  it('e-mail texto: assunto preenchido e HTML do envio com a assinatura', () => {
    const previa = previaTemplate({ canal: 'email', assunto: 'Validade em {{data_validade}}', corpo: 'Olá {{nome}}', html: null })
    expect(previa.assunto).toBe('Validade em 30/09/2026')
    expect(previa.html).toContain('Olá Maria')
    expect(previa.html).toContain('Aline')
    expect(previa.html).toContain('Laudo Técnico')
  })

  it('e-mail HTML: usa o HTML preenchido e remove script', () => {
    const previa = previaTemplate({
      canal: 'email',
      assunto: 'Oi',
      corpo: 'Texto alternativo',
      html: '<p>Renovação da <strong>{{empresa}}</strong></p><script>alert(1)</script>',
    })
    expect(previa.html).toContain('<p>Renovação da <strong>Empresa Exemplo</strong></p>')
    expect(previa.html).not.toContain('<script')
    expect(previa.html).not.toContain('Texto alternativo')
  })

  it('WhatsApp: sem assunto e sem HTML', () => {
    const previa = previaTemplate({ canal: 'whatsapp', assunto: null, corpo: 'Oi {{nome}}', html: null })
    expect(previa).toEqual({ assunto: '', texto: 'Oi Maria', html: null })
  })

  it('HTML existente com link de query string não acumula escape na prévia', () => {
    const previa = previaTemplate({
      canal: 'email',
      assunto: 'x',
      corpo: 'x',
      html: '<a href="https://art.com.br/r?a=1&amp;b=2">Renovar</a>',
    })
    expect(previa.html).toContain('href="https://art.com.br/r?a=1&amp;b=2"')
    expect(previa.html).not.toContain('&amp;amp;')
  })
})

describe('prévia não tem efeito', () => {
  it('não usa rede: fetch nunca é chamado', () => {
    const original = globalThis.fetch
    let chamadas = 0
    globalThis.fetch = ((...args: unknown[]) => { chamadas++; throw new Error(`a prévia não pode usar rede: ${String(args[0])}`) }) as typeof fetch
    try {
      previaTemplate({ canal: 'email', assunto: 'a', corpo: 'b', html: '<p>c</p>' })
    } finally {
      globalThis.fetch = original
    }
    expect(chamadas).toBe(0)
  })

  it('o módulo não conhece banco, provedor de envio nem rede', () => {
    const fonte = readFileSync(path.join(process.cwd(), 'lib', 'templates', 'previa.ts'), 'utf-8')
    expect(fonte).not.toMatch(/supabase|nodemailer|fetch\(|EmailProvider|server-only|registrarInteracao/)
  })
})
