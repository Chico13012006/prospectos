// Cobre a seleção de template do motor: fallback nicho→genérico, threading do
// assunto ("Re:" do 1º contato) e preenchimento de variáveis. Usa o MemoryStore,
// que lê do mesmo SEED_TEMPLATES que popula a tabela `templates`.
import { describe, it, expect } from 'vitest'
import { MemoryStore } from '../store/memoryStore'
import { montarEmail, normalizarNicho, preencher, indiceVariante } from '../mensagem'
import { makeLead } from './helpers'

const store = new MemoryStore()

describe('normalizarNicho', () => {
  it('casa nicho canônico (acento/caixa-insensível)', () => {
    expect(normalizarNicho('Óticas')).toBe('oticas')
    expect(normalizarNicho('INDÚSTRIA')).toBe('industria')
  })
  it('mapeia sinônimos', () => {
    expect(normalizarNicho('Saúde')).toBe('hospital')
    expect(normalizarNicho('Comércio')).toBe('varejo')
  })
  it('desconhecido/vazio → null (genérico)', () => {
    expect(normalizarNicho('Mineração')).toBeNull()
    expect(normalizarNicho('')).toBeNull()
    expect(normalizarNicho(null)).toBeNull()
  })
})

describe('preencher', () => {
  it('troca as variáveis pelos dados do lead', () => {
    const lead = makeLead({ contato_nome: 'João Silva', empresa: 'Acme', cidade: 'Recife' })
    const out = preencher('Olá {nome}, da {empresa} em {cidade}. — {responsavel_comercial}', lead)
    expect(out).toBe('Olá João, da Acme em Recife. — Francisco')
  })
  it('limpa resíduo quando o nome está vazio', () => {
    const lead = makeLead({ contato_nome: '' })
    expect(preencher('Olá {nome}, tudo bem?', lead)).toBe('Olá, tudo bem?')
  })
  it('mantém o dia exato da validade sem deslocamento de fuso', () => {
    const lead = makeLead({ data_validade: '2026-08-30' })
    expect(preencher('Validade: {data_validade}', lead)).toBe('Validade: 30/08/2026')
  })
})

describe('montarEmail — seleção com fallback', () => {
  it('1º contato de nicho conhecido usa o template do nicho', async () => {
    const lead = makeLead({ segmento: 'Óticas', empresa: 'VejaBem', contato_nome: 'Maria Souza' })
    const msg = await montarEmail(store, lead, { tipo: 'abordagem' })
    expect(msg.assunto).toBe('Inventário e baixa automática na VejaBem')
    expect(msg.corpo).toContain('operações de óticas')
    expect(msg.corpo.startsWith('Olá Maria,')).toBe(true)
  })

  it('1º contato sem segmento cai no GENÉRICO', async () => {
    const lead = makeLead({ segmento: '', empresa: 'Piloto SA' })
    const msg = await montarEmail(store, lead, { tipo: 'abordagem' })
    expect(msg.assunto).toBe('Piloto SA — perdas no estoque')
    expect(msg.corpo).toContain('RFID pra ajudar empresas como a Piloto SA')
  })

  it('segmento desconhecido cai no GENÉRICO', async () => {
    const lead = makeLead({ segmento: 'Mineração', empresa: 'Ferro Ltda' })
    const msg = await montarEmail(store, lead, { tipo: 'abordagem' })
    expect(msg.assunto).toBe('Ferro Ltda — perdas no estoque')
  })
})

describe('montarEmail — follow-ups e threading (item 3: mesmo template nas 8 etapas)', () => {
  it('follow-up threada do 1º contato do nicho e usa o follow_up_1', async () => {
    const lead = makeLead({ segmento: 'Óticas', empresa: 'VejaBem' })
    const fup1 = await montarEmail(store, lead, { tipo: 'follow_up', numero: 1 })
    // assunto = "Re: " + assunto do 1º contato de Óticas
    expect(fup1.assunto).toBe('Re: Inventário e baixa automática na VejaBem')
    expect(fup1.corpo).toContain('Passando por aqui novamente')
  })

  it('follow-up sem segmento threada do 1º contato GENÉRICO', async () => {
    const lead = makeLead({ segmento: '', empresa: 'Piloto SA' })
    const fup = await montarEmail(store, lead, { tipo: 'follow_up', numero: 2 })
    expect(fup.assunto).toBe('Re: Piloto SA — perdas no estoque')
    // mesmo conteúdo do follow_up_1, independentemente do número.
    expect(fup.corpo).toContain('Passando por aqui novamente')
  })

  it('TODAS as 8 etapas usam o MESMO conteúdo — só muda o espaçamento (item 3)', async () => {
    const lead = makeLead({ segmento: '', empresa: 'Piloto SA' })
    const corpos: string[] = []
    for (let n = 1; n <= 8; n++) {
      corpos.push((await montarEmail(store, lead, { tipo: 'follow_up', numero: n })).corpo)
    }
    expect(new Set(corpos).size).toBe(1) // idêntico em todas as etapas
    expect(corpos[0]).toContain('Passando por aqui novamente')
  })
})

describe('A/B testing — indiceVariante (item 6)', () => {
  it('é determinístico por seed (mesmo lead → mesma variante)', () => {
    expect(indiceVariante('lead-123', 3)).toBe(indiceVariante('lead-123', 3))
  })

  it('cai sempre em [0, n) e é 0 quando há 0 ou 1 variante', () => {
    expect(indiceVariante('x', 0)).toBe(0)
    expect(indiceVariante('x', 1)).toBe(0)
    for (const seed of ['a', 'lead-9', 'xyz', '00000000-1111']) {
      const i = indiceVariante(seed, 4)
      expect(i).toBeGreaterThanOrEqual(0)
      expect(i).toBeLessThan(4)
    }
  })

  it('distribui de forma equilibrada entre as variantes (A/B justo)', () => {
    const contagem = [0, 0]
    for (let k = 0; k < 1000; k++) contagem[indiceVariante(`lead-${k}`, 2)]++
    for (const c of contagem) expect(Math.abs(c - 500)).toBeLessThan(150)
  })

  it('montarEmail devolve o templateId da variante escolhida', async () => {
    const store = new MemoryStore()
    const lead = makeLead({ segmento: 'oticas' })
    const r = await montarEmail(store, lead, { tipo: 'abordagem' })
    expect(r.templateId).toBeTruthy()
  })
})
