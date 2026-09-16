import { describe, expect, it } from 'vitest'
import {
  LIMITE_HTML_TEMPLATE_BYTES,
  MENSAGEM_CHAVE_IMUTAVEL,
  ehUuid,
  formatoDoTemplate,
  mapearTemplate,
  validarEdicaoTemplate,
  validarNovoTemplate,
  type TemplateBiblioteca,
} from '../tipos'

const EMAIL = {
  nome: 'Renovação do laudo',
  canal: 'email',
  tipo: 'renovacao_1',
  assunto: 'Validade em {data_validade}',
  corpo: 'Olá {{nome}}, tudo bem?',
}

function atual(parcial: Partial<TemplateBiblioteca> = {}): TemplateBiblioteca {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    nome: 'Renovação do laudo',
    canal: 'email',
    formato: 'texto',
    tipo: 'renovacao_1',
    nicho: null,
    assunto: 'Validade em {data_validade}',
    corpo: 'Olá {{nome}}',
    html: null,
    ativo: true,
    somenteLeitura: false,
    criadoEm: null,
    atualizadoEm: null,
    ...parcial,
  }
}

describe('validarNovoTemplate', () => {
  it('e-mail em texto simples: guarda assunto e corpo, formato texto', () => {
    const r = validarNovoTemplate(EMAIL)
    expect(r).toEqual({
      ok: true,
      valor: { ...EMAIL, nicho: null, html: null },
    })
    if (r.ok) expect(formatoDoTemplate(r.valor)).toBe('texto')
  })

  it('e-mail HTML: sanitiza script e eventos e deriva o texto quando o corpo não vem', () => {
    const r = validarNovoTemplate({
      ...EMAIL,
      corpo: '',
      html: '<p onclick="roubar()">Olá {{nome}}</p><script>alert(1)</script><img src="javascript:x">',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valor.html).toBe('<p>Olá {{nome}}</p><img />')
    expect(r.valor.corpo).toBe('Olá {{nome}}')
    expect(formatoDoTemplate(r.valor)).toBe('html')
  })

  it('e-mail HTML com corpo informado mantém o texto escrito', () => {
    const r = validarNovoTemplate({ ...EMAIL, html: '<p>Versão HTML</p>' })
    expect(r.ok && r.valor.corpo).toBe(EMAIL.corpo)
  })

  it('e-mail exige assunto', () => {
    expect(validarNovoTemplate({ ...EMAIL, assunto: '  ' })).toEqual({ ok: false, erro: 'Informe o assunto do e-mail.' })
  })

  it('WhatsApp é texto: HTML proibido e assunto descartado', () => {
    expect(validarNovoTemplate({ ...EMAIL, canal: 'whatsapp', html: '<p>oi</p>' })).toEqual({
      ok: false,
      erro: 'HTML só é permitido em templates de e-mail.',
    })
    const r = validarNovoTemplate({ ...EMAIL, canal: 'whatsapp' })
    expect(r.ok && r.valor).toMatchObject({ canal: 'whatsapp', assunto: null, html: null, corpo: EMAIL.corpo })
  })

  it('HTML acima do limite ou sem conteúdo visível é recusado', () => {
    const grande = `<p>${'a'.repeat(LIMITE_HTML_TEMPLATE_BYTES)}</p>`
    expect(validarNovoTemplate({ ...EMAIL, html: grande }).ok).toBe(false)
    expect(validarNovoTemplate({ ...EMAIL, corpo: '', html: '<script>alert(1)</script>' })).toEqual({
      ok: false,
      erro: 'O HTML não tem conteúdo visível depois da sanitização.',
    })
  })

  it('tipo: prefixo de campanha é reservado, formato livre é recusado, maiúsculas normalizam', () => {
    expect(validarNovoTemplate({ ...EMAIL, tipo: 'campanha_abc_m1' }).ok).toBe(false)
    expect(validarNovoTemplate({ ...EMAIL, tipo: 'Primeiro contato!' }).ok).toBe(false)
    const r = validarNovoTemplate({ ...EMAIL, tipo: 'FOLLOW_UP_1' })
    expect(r.ok && r.valor.tipo).toBe('follow_up_1')
  })

  it('segmento usa a chave canônica e vazio vira genérico', () => {
    const hotel = validarNovoTemplate({ ...EMAIL, nicho: 'Hotel' })
    expect(hotel.ok && hotel.valor.nicho).toBe('hotelaria')
    const vazio = validarNovoTemplate({ ...EMAIL, nicho: '' })
    expect(vazio.ok && vazio.valor.nicho).toBeNull()
  })

  it('ignora organização, id, ativo e autoria vindos do cliente', () => {
    const r = validarNovoTemplate({
      ...EMAIL,
      organizacao_id: 'org-alheia',
      id: 'x',
      ativo: false,
      criado_por: 'alguem',
    })
    expect(r.ok && Object.keys(r.valor).sort()).toEqual(['assunto', 'canal', 'corpo', 'html', 'nicho', 'nome', 'tipo'])
  })

  it('nome e canal são obrigatórios', () => {
    expect(validarNovoTemplate({ ...EMAIL, nome: '' }).ok).toBe(false)
    expect(validarNovoTemplate({ ...EMAIL, canal: 'sms' })).toEqual({ ok: false, erro: 'Canal inválido.' })
  })
})

describe('validarEdicaoTemplate', () => {
  it('canal, estágio e segmento não mudam depois de criado', () => {
    for (const troca of [{ canal: 'whatsapp' }, { tipo: 'follow_up_1' }, { nicho: 'varejo' }]) {
      expect(validarEdicaoTemplate(atual(), { nome: 'x', ...troca })).toEqual({ ok: false, erro: MENSAGEM_CHAVE_IMUTAVEL })
    }
    expect(validarEdicaoTemplate(atual(), { nome: 'x', canal: 'email', tipo: 'renovacao_1', nicho: '' }).ok).toBe(true)
  })

  it('editar só o nome preserva o HTML gravado byte a byte (sem reescapar links)', () => {
    const html = '<a href="https://art.com.br/?a=1&amp;b=2">Renovar</a>'
    const r = validarEdicaoTemplate(atual({ html, formato: 'html', corpo: 'Renovar' }), { nome: 'Novo nome' })
    expect(r).toEqual({ ok: true, valor: { nome: 'Novo nome', assunto: 'Validade em {data_validade}', corpo: 'Renovar', html } })
  })

  it('HTML novo sem corpo refaz o texto equivalente; remover o HTML volta a texto', () => {
    const trocado = validarEdicaoTemplate(atual({ html: '<p>Antigo</p>', corpo: 'Antigo' }), { html: '<p>Novo conteúdo</p>' })
    expect(trocado.ok && trocado.valor).toMatchObject({ html: '<p>Novo conteúdo</p>', corpo: 'Novo conteúdo' })
    const removido = validarEdicaoTemplate(atual({ html: '<p>Antigo</p>', corpo: 'Antigo' }), { html: '' })
    expect(removido.ok && removido.valor).toMatchObject({ html: null, corpo: 'Antigo' })
  })

  it('WhatsApp continua sem HTML na edição', () => {
    const whatsapp = atual({ canal: 'whatsapp', assunto: null })
    expect(validarEdicaoTemplate(whatsapp, { html: '<b>oi</b>' }).ok).toBe(false)
  })
})

describe('mapearTemplate', () => {
  it('marca cópia de campanha como somente leitura e não expõe organização', () => {
    const t = mapearTemplate({
      id: 'id-1',
      nome: 'CAMPANHA — mensagem 1',
      canal: 'email',
      tipo: 'campanha_d283b6e4_m1',
      nicho: null,
      assunto: 'a',
      corpo: 'b',
      html: null,
      ativo: null,
      created_at: '2026-09-15T00:00:00Z',
      atualizado_em: '2026-09-15T00:00:00Z',
      organizacao_id: 'org',
    } as never)
    expect(t.somenteLeitura).toBe(true)
    expect(t.ativo).toBe(false)
    expect(t).not.toHaveProperty('organizacao_id')
  })

  it('ehUuid aceita só UUID', () => {
    expect(ehUuid('03097614-9fd5-4491-a91c-589f84461683')).toBe(true)
    expect(ehUuid('1 or 1=1')).toBe(false)
    expect(ehUuid(undefined)).toBe(false)
  })
})
