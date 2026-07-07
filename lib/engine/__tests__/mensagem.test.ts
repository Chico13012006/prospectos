// Cobre a seleção de template do motor: fallback nicho→genérico, threading do
// assunto ("Re:" do 1º contato) e preenchimento de variáveis. Usa o MemoryStore,
// que lê do mesmo SEED_TEMPLATES que popula a tabela `templates`.
import { describe, it, expect } from 'vitest'
import { MemoryStore } from '../store/memoryStore'
import { montarEmail, normalizarNicho, preencher } from '../mensagem'
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

describe('montarEmail — follow-ups e threading', () => {
  it('follow-up é genérico e o assunto threada do 1º contato do nicho', async () => {
    const lead = makeLead({ segmento: 'Óticas', empresa: 'VejaBem' })
    const fup1 = await montarEmail(store, lead, { tipo: 'follow_up', numero: 1 })
    // assunto = "Re: " + assunto do 1º contato de Óticas
    expect(fup1.assunto).toBe('Re: Inventário e baixa automática na VejaBem')
    expect(fup1.corpo).toContain('Passando por aqui novamente')
  })

  it('follow-up sem segmento threada do 1º contato GENÉRICO', async () => {
    const lead = makeLead({ segmento: '', empresa: 'Piloto SA' })
    const fup2 = await montarEmail(store, lead, { tipo: 'follow_up', numero: 2 })
    expect(fup2.assunto).toBe('Re: Piloto SA — perdas no estoque')
    expect(fup2.corpo).toContain('vou ser direto')
  })

  it('follow-up 3 oferece um exemplo e pede só "sim"', async () => {
    const lead = makeLead({ segmento: '', empresa: 'Piloto SA' })
    const fup3 = await montarEmail(store, lead, { tipo: 'follow_up', numero: 3 })
    expect(fup3.corpo).toContain('um exemplo rápido')
    expect(fup3.corpo).toContain('responder "sim"')
  })

  it('follow-up 4 é o encerramento (última tentativa)', async () => {
    const lead = makeLead({ segmento: '', empresa: 'Piloto SA' })
    const fup4 = await montarEmail(store, lead, { tipo: 'follow_up', numero: 4 })
    expect(fup4.corpo).toContain('última mensagem')
  })

  it('nº de follow-up acima do máximo usa o último template (cap em 4)', async () => {
    const lead = makeLead({ segmento: '', empresa: 'Piloto SA' })
    const fup = await montarEmail(store, lead, { tipo: 'follow_up', numero: 9 })
    expect(fup.corpo).toContain('última mensagem') // follow_up_4
  })
})
