import { describe, expect, it } from 'vitest'
import { extrairAcaoIdsPublicados, mensagensNaOrdem, resolverAcaoIds } from '../acaoId'
import type { DefinicaoWorkflow } from '@/lib/workflows/types'

// Gerador de id determinístico e sequencial p/ testes ('novo-1', 'novo-2', …) —
// não usamos randomUUID aqui para poder afirmar exatamente QUAL mensagem
// recebeu QUAL id novo, sem depender de comparar UUIDs opacos.
function contadorDeIds(prefixo = 'novo') {
  let n = 0
  return () => `${prefixo}-${++n}`
}

describe('acaoId — identidade estável de mensagem de campanha', () => {
  it('mensagem já com acaoId nunca é recalculada (preserva em re-save)', () => {
    const mensagens = [{ assunto: 'A', acaoId: 'ja-tenho-id' }]
    const resultado = resolverAcaoIds(mensagens, [], contadorDeIds())
    expect(resultado[0].acaoId).toBe('ja-tenho-id')
  })

  it('campanha nova (sem versão publicada) gera UUID novo por mensagem, na ordem', () => {
    const mensagens = mensagensNaOrdem(
      { assunto: 'Inicial' },
      [{ assunto: 'Follow 1' }, { assunto: 'Follow 2' }],
    )
    const resultado = resolverAcaoIds(mensagens, [], contadorDeIds())
    expect(resultado.map((m) => m.acaoId)).toEqual(['novo-1', 'novo-2', 'novo-3'])
  })

  it('campanha legada herda o id da versão JÁ PUBLICADA (não inventa UUID)', () => {
    const mensagens = mensagensNaOrdem({ assunto: 'Inicial' }, [])
    const resultado = resolverAcaoIds(mensagens, ['email-0'], contadorDeIds())
    expect(resultado[0].acaoId).toBe('email-0') // e não um UUID novo
  })

  it('reordenar mensagens preserva o acaoId de CADA mensagem (id viaja com o objeto, não com a posição)', () => {
    const inicial = { assunto: 'Inicial', acaoId: 'id-inicial' }
    const f1 = { assunto: 'F1', acaoId: 'id-f1' }
    const f2 = { assunto: 'F2', acaoId: 'id-f2' }

    // ordem original
    const antes = resolverAcaoIds([inicial, f1, f2], [], contadorDeIds())
    // f2 e f1 trocados de posição
    const depois = resolverAcaoIds([inicial, f2, f1], [], contadorDeIds())

    expect(antes.find((m) => m.assunto === 'F1')?.acaoId).toBe('id-f1')
    expect(antes.find((m) => m.assunto === 'F2')?.acaoId).toBe('id-f2')
    expect(depois.find((m) => m.assunto === 'F1')?.acaoId).toBe('id-f1')
    expect(depois.find((m) => m.assunto === 'F2')?.acaoId).toBe('id-f2')
  })

  it('inserir uma mensagem nova não altera o acaoId das existentes', () => {
    const inicial = { assunto: 'Inicial', acaoId: 'id-inicial' }
    const f1 = { assunto: 'F1', acaoId: 'id-f1' }
    const novoFollowup = { assunto: 'Recém-adicionado' } // sem acaoId ainda

    // inserido NO MEIO — a posição de f1 muda, mas seu id não pode mudar
    const resultado = resolverAcaoIds([inicial, novoFollowup, f1], [], contadorDeIds())

    expect(resultado.find((m) => m.assunto === 'Inicial')?.acaoId).toBe('id-inicial')
    expect(resultado.find((m) => m.assunto === 'F1')?.acaoId).toBe('id-f1')
    expect(resultado.find((m) => m.assunto === 'Recém-adicionado')?.acaoId).toBe('novo-1')
  })

  it('excluir uma mensagem não altera o acaoId das demais', () => {
    const inicial = { assunto: 'Inicial', acaoId: 'id-inicial' }
    const f1 = { assunto: 'F1', acaoId: 'id-f1' }
    const f2 = { assunto: 'F2', acaoId: 'id-f2' }

    const completo = resolverAcaoIds([inicial, f1, f2], [], contadorDeIds())
    const semF1 = resolverAcaoIds([inicial, f2], [], contadorDeIds()) // f1 removido

    expect(completo.find((m) => m.assunto === 'Inicial')?.acaoId)
      .toBe(semF1.find((m) => m.assunto === 'Inicial')?.acaoId)
    expect(completo.find((m) => m.assunto === 'F2')?.acaoId)
      .toBe(semF1.find((m) => m.assunto === 'F2')?.acaoId)
  })

  it('clone: mensagens SEM acaoId (campo removido de propósito pelo clonador) recebem UUIDs NOVOS, diferentes da origem', () => {
    const origem = resolverAcaoIds(
      mensagensNaOrdem({ assunto: 'Inicial' }, [{ assunto: 'F1' }]),
      [],
      contadorDeIds('origem'),
    )
    // Contrato do clone: copia os campos de conteúdo, mas NUNCA acaoId/templateId.
    const publicoParaClone = origem.map(({ acaoId: _descartado, templateId: _tambemDescartado, ...resto }) => resto)

    const clone = resolverAcaoIds(publicoParaClone, [], contadorDeIds('clone'))

    expect(clone.map((m) => m.acaoId)).toEqual(['clone-1', 'clone-2'])
    expect(clone.map((m) => m.acaoId)).not.toEqual(origem.map((m) => m.acaoId))
  })

  it('adicionar followup a uma campanha legada: o original herda o id publicado, o novo ganha UUID', () => {
    const mensagens = mensagensNaOrdem({ assunto: 'Inicial' }, [{ assunto: 'Follow novo' }])
    const resultado = resolverAcaoIds(mensagens, ['email-0'], contadorDeIds())

    expect(resultado[0].acaoId).toBe('email-0')       // herdado da versão publicada
    expect(resultado[1].acaoId).toBe('novo-1')         // mensagem nova, nunca publicada
  })

  it('extrairAcaoIdsPublicados lê só ações enviar_email, na ordem, ignorando esperas e ações sem id', () => {
    const def: DefinicaoWorkflow = {
      gatilho: { id: 'g', tipo: 'manual', config: {} },
      condicoes: [],
      acoes: [
        { id: 'email-0', tipo: 'enviar_email', config: {} },
        { id: 'espera-1', tipo: 'esperar', config: {} },
        { id: 'email-1', tipo: 'enviar_email', config: {} },
        { tipo: 'enviar_email', config: {} }, // sem id — defensivo, não deveria existir na prática
      ],
    }
    expect(extrairAcaoIdsPublicados(def)).toEqual(['email-0', 'email-1'])
  })

  it('extrairAcaoIdsPublicados devolve lista vazia sem versão publicada', () => {
    expect(extrairAcaoIdsPublicados(null)).toEqual([])
    expect(extrairAcaoIdsPublicados(undefined)).toEqual([])
  })
})
