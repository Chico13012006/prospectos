import { describe, it, expect } from 'vitest'
import { montarPromptAnalise, normalizarAnalise } from '../ia/copilotoReuniao'

describe('copiloto — normalizarAnalise', () => {
  it('descarta equipamento fora do vocabulário e força quantidade >= 1', () => {
    const r = normalizarAnalise({
      resumo: 'ok',
      equipamentos: [
        { produto: 'coletor', quantidade: 3, origem: 'mencionado', justificativa: 'Citado no piloto.' },
        { produto: 'drone', quantidade: 2 }, // inválido → descartado
        { produto: 'pdv', quantidade: 0, origem: 'recomendado', justificativa: 'Validar no caixa.' }, // qtd inválida → vira 1
      ],
    })
    expect(r.equipamentos).toEqual([
      { produto: 'coletor', quantidade: 3, origem: 'mencionado', justificativa: 'Citado no piloto.' },
      { produto: 'pdv', quantidade: 1, origem: 'recomendado', justificativa: 'Validar no caixa.' },
    ])
  })

  it('só aceita estágio dentro do enum; senão null', () => {
    expect(normalizarAnalise({ estagioSugerido: 'reuniao_agendada' }).estagioSugerido).toBe('reuniao_agendada')
    expect(normalizarAnalise({ estagioSugerido: 'inventado' }).estagioSugerido).toBeNull()
    expect(normalizarAnalise({ estagioSugerido: '' }).estagioSugerido).toBeNull()
  })

  it('coage listas e strings ausentes para vazio (nunca undefined)', () => {
    const r = normalizarAnalise({})
    expect(r.resumo).toBe('')
    expect(r.dores).toEqual([])
    expect(r.objecoes).toEqual([])
    expect(r.lacunasDescoberta).toEqual([])
    expect(r.equipamentos).toEqual([])
    expect(r.proximoFollowup).toBe('')
    expect(r.emailCorpo).toBe('')
  })

  it('limpa entradas em branco das listas', () => {
    const r = normalizarAnalise({ dores: ['   ', 'preço alto', ''], tarefas: ['enviar proposta'] })
    expect(r.dores).toEqual(['preço alto'])
    expect(r.tarefas).toEqual(['enviar proposta'])
  })
})

describe('copiloto — composição do contexto', () => {
  it('separa conhecimento, playbook, lead e transcrição com regra contra alucinação', () => {
    const prompt = montarPromptAnalise('Cliente relatou inventário manual.', {
      empresa: 'Óticas Visão',
      segmento: 'Varejo',
      cidade: 'Campinas',
      estado: 'SP',
      contato: 'Ana',
      cargo: 'Diretora de operações',
      origem: 'Indicação',
      estagioAtual: 'reuniao_agendada',
      proximaAcao: 'Preparar piloto',
      responsavel: 'Bruno',
      historico: [{
        tipo: 'reuniao',
        canal: 'video',
        descricao: 'Mapeamento inicial do processo.',
        realizadaEm: '2026-09-10T14:00:00.000Z',
      }],
    })

    expect(prompt.system).toContain('[CONHECIMENTO INOVACODE]')
    expect(prompt.system).toContain('[PLAYBOOK COMERCIAL INOVACODE]')
    expect(prompt.system).toContain('Não os trate como fatos ditos pelo cliente')
    expect(prompt.user).toContain('[CONTEXTO REAL DO LEAD]')
    expect(prompt.user).toContain('Empresa: Óticas Visão')
    expect(prompt.user).toContain('Mapeamento inicial do processo.')
    expect(prompt.user).toContain('[TRANSCRIÇÃO DA REUNIÃO ATUAL]\nCliente relatou inventário manual.')
  })

  it('continua funcional sem lead selecionado', () => {
    const prompt = montarPromptAnalise('Transcrição independente e suficientemente detalhada.')

    expect(prompt.user).toContain('Nenhum lead selecionado')
    expect(prompt.user).toContain('Transcrição independente e suficientemente detalhada.')
    expect(prompt.system).toContain('A transcrição da reunião atual é a fonte')
  })

  it('inclui no prompt os sinais e gaps do cenário de óticas sem prometer arquitetura', () => {
    const transcricao = [
      'O cliente possui uma rede de óticas com 8 lojas e entre 1.500 e 2.500 armações por unidade.',
      'O controle é sistêmico, mas falta visibilidade do estoque físico e já ocorreram furtos.',
      'O inventário é manual. Existe preocupação com antenas aparentes e com a estética da tag.',
      'O cliente aceita avaliar um piloto e levantará o sistema utilizado e o valor das perdas.',
      'A InovaCode deve preparar uma arquitetura e uma proposta de piloto.',
    ].join(' ')
    const prompt = montarPromptAnalise(transcricao)

    expect(prompt.user).toContain('1.500 e 2.500 armações')
    expect(prompt.system).toMatch(/um coletor móvel\s+pode ser um início melhor/)
    expect(prompt.system).toContain('nenhuma integração está garantida')
    expect(prompt.system).toMatch(/ROI nunca\s+deve ser prometido sem dados suficientes/)
    expect(prompt.system).toContain('GAPS DE DESCOBERTA A VERIFICAR')
    expect(prompt.system).toContain('impressora RFID centralizada no CD ou backoffice')
    expect(prompt.system).toContain('segunda checagem do vendedor')
    expect(prompt.system).toContain('resumo com até 100 palavras')
  })

  it('limita listas para manter o retorno operacional e conciso', () => {
    const r = normalizarAnalise({
      dores: ['1', '2', '3', '4', '5'],
      objecoes: ['1', '2', '3', '4'],
      lacunasDescoberta: ['1', '2', '3', '4', '5'],
    })

    expect(r.dores).toEqual(['1', '2', '3', '4'])
    expect(r.objecoes).toEqual(['1', '2', '3'])
    expect(r.lacunasDescoberta).toEqual(['1', '2', '3', '4'])
  })
})
