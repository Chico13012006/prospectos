import { describe, it, expect } from 'vitest'
import { descreverCadencia, rotuloDoDia, rotuloDaEspera } from '../cadenciaLegivel'
import type { DefinicaoWorkflow } from '@/lib/workflows/types'

// Definição real de uma campanha materializada (Prospecção — Piloto Laudos):
// e-mail → espera 3 dias → e-mail.
const DEF: DefinicaoWorkflow = {
  gatilho: { id: 'gatilho-manual', tipo: 'manual', config: {} },
  condicoes: [],
  acoes: [
    { id: 'email-0', tipo: 'enviar_email', config: { template: 'campanha_abc_m1' } },
    { id: 'espera-1', tipo: 'esperar', config: { dias: 3, horas: 0 } },
    { id: 'email-1', tipo: 'enviar_email', config: { template: 'campanha_abc_m2' } },
  ],
}

const OPERACAO = {
  mensagemInicial: { assunto: 'Laudo de brinquedos — {empresa}' },
  followups: [{ assunto: 'Re: Laudo de brinquedos', diasApos: 3 }],
}

describe('descreverCadencia', () => {
  it('acumula as esperas como deslocamento em dias', () => {
    const passos = descreverCadencia(DEF, OPERACAO)
    expect(passos).toHaveLength(2) // a espera não é passo, vira o "dia" do seguinte
    expect(passos[0].dia).toBe(0)
    expect(passos[1].dia).toBe(3)
    expect(passos[1].esperaAntes).toBe(3)
  })

  it('numera os e-mails e traz o assunto configurado na campanha', () => {
    const passos = descreverCadencia(DEF, OPERACAO)
    expect(passos[0].rotulo).toBe('E-mail 1')
    expect(passos[0].detalhe).toBe('Laudo de brinquedos — {empresa}')
    expect(passos[1].rotulo).toBe('E-mail 2')
    expect(passos[1].detalhe).toBe('Re: Laudo de brinquedos')
  })

  it('sem assunto configurado devolve null em vez de inventar texto', () => {
    const passos = descreverCadencia(DEF, undefined)
    expect(passos[0].detalhe).toBeNull()
    expect(passos[1].detalhe).toBeNull()
  })

  it('soma horas como fração de dia sem estourar para o dia seguinte', () => {
    const def: DefinicaoWorkflow = {
      ...DEF,
      acoes: [
        { id: 'a', tipo: 'enviar_email', config: {} },
        { id: 'b', tipo: 'esperar', config: { dias: 0, horas: 12 } },
        { id: 'c', tipo: 'enviar_email', config: {} },
      ],
    }
    const passos = descreverCadencia(def, undefined)
    expect(passos[1].dia).toBe(0.5)
    expect(rotuloDoDia(passos[1].dia)).toBe('12h depois')
  })

  it('descreve passos que não são mensagem, sem numerá-los', () => {
    const def: DefinicaoWorkflow = {
      ...DEF,
      acoes: [
        { id: 'a', tipo: 'enviar_email', config: {} },
        { id: 'b', tipo: 'criar_tarefa', config: {} },
        { id: 'c', tipo: 'enviar_whatsapp', config: {} },
      ],
    }
    const passos = descreverCadencia(def, undefined)
    expect(passos.map((p) => p.rotulo)).toEqual(['E-mail 1', 'Tarefa', 'WhatsApp 1'])
  })

  it('tipo desconhecido aparece cru em vez de sumir da sequência', () => {
    const def: DefinicaoWorkflow = {
      ...DEF,
      acoes: [{ id: 'x', tipo: 'bloco_novo_qualquer', config: {} }],
    }
    expect(descreverCadencia(def, undefined)[0].rotulo).toBe('bloco_novo_qualquer')
  })

  it('definição ausente ou sem ações devolve lista vazia', () => {
    expect(descreverCadencia(null, OPERACAO)).toEqual([])
    expect(descreverCadencia({ ...DEF, acoes: [] }, OPERACAO)).toEqual([])
  })
})

describe('rótulos', () => {
  it('rotuloDoDia', () => {
    expect(rotuloDoDia(0)).toBe('Dia 0')
    expect(rotuloDoDia(3)).toBe('Dia 3')
    expect(rotuloDoDia(0.5)).toBe('12h depois')
    expect(rotuloDoDia(1.25)).toBe('Dia 1 + 6h')
  })

  it('rotuloDaEspera', () => {
    expect(rotuloDaEspera(0)).toBeNull()
    expect(rotuloDaEspera(1)).toBe('espera 1 dia')
    expect(rotuloDaEspera(3)).toBe('espera 3 dias')
    expect(rotuloDaEspera(0.5)).toBe('espera 12h')
  })
})
