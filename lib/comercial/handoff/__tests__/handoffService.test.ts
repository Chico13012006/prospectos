import { describe, it, expect } from 'vitest'
import { atribuirResponsavelHandoff, definirParticipacaoComercial, listarDistribuicaoComercial, MAX_TENTATIVAS_HANDOFF } from '../handoffService'
import { MemoryHandoffRepository } from './memoryRepository'
import type { EntradaHandoff } from '../types'

const ORG_A = 'org-a'
const ORG_B = 'org-b'

// Cenário padrão: 3 comerciais na org A (ordem estável Bruno < Guilherme <
// Silmara), 2 na org B, leads em cada uma.
function cenario() {
  const repo = new MemoryHandoffRepository()
  repo
    .addUsuario({ id: 'bruno', organizacaoId: ORG_A, nome: 'Bruno' })
    .addUsuario({ id: 'silmara', organizacaoId: ORG_A, nome: 'Silmara' })
    .addUsuario({ id: 'guilherme', organizacaoId: ORG_A, nome: 'Guilherme' })
    .addUsuario({ id: 'joao', organizacaoId: ORG_A, nome: 'João' }) // não participa
    .addUsuario({ id: 'ana-b', organizacaoId: ORG_B, nome: 'Ana' })
    .addUsuario({ id: 'caio-b', organizacaoId: ORG_B, nome: 'Caio' })
    .participar(ORG_A, 'bruno').participar(ORG_A, 'silmara').participar(ORG_A, 'guilherme')
    .participar(ORG_B, 'ana-b').participar(ORG_B, 'caio-b')
  for (let i = 1; i <= 8; i++) repo.addLead({ id: `la${i}`, organizacaoId: ORG_A, responsavelId: 'sdr-importador' })
  for (let i = 1; i <= 4; i++) repo.addLead({ id: `lb${i}`, organizacaoId: ORG_B })
  return repo
}

const entrada = (leadId: string, eventoId = `ev-${leadId}`, org = ORG_A): EntradaHandoff =>
  ({ organizacaoId: org, leadId, eventoId, origem: 'prospeccao' })

async function atribuir(repo: MemoryHandoffRepository, leadId: string, eventoId?: string, org?: string) {
  const r = await atribuirResponsavelHandoff(repo, entrada(leadId, eventoId, org))
  if (r.tipo !== 'atribuido') throw new Error(`esperava 'atribuido', veio '${r.tipo}'`)
  return r
}

describe('handoff — round-robin (1º handoff)', () => {
  it('1. gira Bruno → Guilherme → Silmara → Bruno e espelha em leads.responsavel_id', async () => {
    const repo = cenario()
    const nomes: string[] = []
    for (const lead of ['la1', 'la2', 'la3', 'la4']) {
      const r = await atribuir(repo, lead)
      nomes.push(r.responsavel.nome)
      expect(r.motivo).toBe('round_robin')
      expect(r.primeiraAtribuicao).toBe(true)
      expect(repo.lead(lead)?.responsavelId).toBe(r.responsavel.id)
      expect(repo.lead(lead)?.responsavelNome).toBe(r.responsavel.nome)
    }
    expect(nomes).toEqual(['Bruno', 'Guilherme', 'Silmara', 'Bruno'])
    expect(repo.cursor(ORG_A)).toEqual({ ultimoUsuarioId: 'bruno', versao: 4 })
  })

  it('sobrescreve o responsável de importação (não é ownership de handoff)', async () => {
    const repo = cenario()
    expect(repo.lead('la1')?.responsavelId).toBe('sdr-importador')
    const r = await atribuir(repo, 'la1')
    expect(repo.lead('la1')?.responsavelId).toBe(r.responsavel.id)
    expect(r.motivo).toBe('round_robin')
  })

  it('2. Silmara fora do rodízio: Bruno → Guilherme → Bruno', async () => {
    const repo = cenario().participar(ORG_A, 'silmara', false)
    const nomes = []
    for (const lead of ['la1', 'la2', 'la3']) nomes.push((await atribuir(repo, lead)).responsavel.nome)
    expect(nomes).toEqual(['Bruno', 'Guilherme', 'Bruno'])
  })

  it('3. Silmara volta e volta a participar no ciclo seguinte', async () => {
    const repo = cenario().participar(ORG_A, 'silmara', false)
    const nomes = []
    for (const lead of ['la1', 'la2']) nomes.push((await atribuir(repo, lead)).responsavel.nome) // Bruno, Guilherme
    expect(await definirParticipacaoComercial(repo, ORG_A, 'silmara', true)).toBe('ok')
    for (const lead of ['la3', 'la4', 'la5']) nomes.push((await atribuir(repo, lead)).responsavel.nome)
    expect(nomes).toEqual(['Bruno', 'Guilherme', 'Silmara', 'Bruno', 'Guilherme'])
  })

  it('quem nunca foi marcado como participante (João) não recebe lead', async () => {
    const repo = cenario()
    const ids = new Set<string>()
    for (let i = 1; i <= 8; i++) ids.add((await atribuir(repo, `la${i}`)).responsavel.id)
    expect(ids.has('joao')).toBe(false)
  })
})

describe('handoff — isolamento entre organizações', () => {
  it('4. distribuir na org A não move o cursor da org B (e vice-versa)', async () => {
    const repo = cenario()
    await atribuir(repo, 'la1'); await atribuir(repo, 'la2')
    expect(repo.cursor(ORG_B)).toEqual({ ultimoUsuarioId: null, versao: 0 })
    const rb = await atribuir(repo, 'lb1', undefined, ORG_B)
    expect(rb.responsavel.id).toBe('ana-b') // começa do início do rodízio DELA
    expect(repo.cursor(ORG_A)).toEqual({ ultimoUsuarioId: 'guilherme', versao: 2 })
    expect(repo.cursor(ORG_B)).toEqual({ ultimoUsuarioId: 'ana-b', versao: 1 })
  })

  it('5. org A nunca recebe usuário da org B, mesmo sendo o único participante do sistema', async () => {
    const repo = new MemoryHandoffRepository()
      .addUsuario({ id: 'ana-b', organizacaoId: ORG_B, nome: 'Ana' })
      .participar(ORG_B, 'ana-b')
      .addLead({ id: 'la1', organizacaoId: ORG_A })
    const r = await atribuirResponsavelHandoff(repo, entrada('la1'))
    expect(r.tipo).toBe('aguardando_distribuicao')
    expect(repo.lead('la1')?.responsavelId).toBeNull()
  })

  it('lead de outra organização → lead_nao_encontrado, nada gravado', async () => {
    const repo = cenario()
    const r = await atribuirResponsavelHandoff(repo, entrada('lb1')) // lb1 é da org B, chamado como org A
    expect(r.tipo).toBe('lead_nao_encontrado')
    expect(repo.handoffs()).toHaveLength(0)
    expect(repo.cursor(ORG_A).versao).toBe(0)
    expect(repo.lead('lb1')?.responsavelId).toBeNull()
  })
})

describe('handoff — reativação', () => {
  it('6/7. preserva o responsável anterior e NÃO avança o cursor', async () => {
    const repo = cenario()
    const primeiro = await atribuir(repo, 'la1') // Bruno
    expect(primeiro.responsavel.id).toBe('bruno')
    // Voltou ao follow-up (fase futura encerra o handoff) e a automação pode
    // ter trocado o responsável no meio — o ownership de handoff é o que vale.
    repo.encerrarHandoff(primeiro.handoff.id)
    repo.lead('la1')!.responsavelId = 'sdr-importador'
    const cursorAntes = repo.cursor(ORG_A)

    const r = await atribuir(repo, 'la1', 'ev-la1-segunda-resposta')
    expect(r.motivo).toBe('reativacao')
    expect(r.primeiraAtribuicao).toBe(false)
    expect(r.responsavel.id).toBe('bruno')
    expect(repo.lead('la1')?.responsavelId).toBe('bruno')
    expect(repo.cursor(ORG_A)).toEqual(cursorAntes)
    // Silmara/Guilherme não perderam o turno: o próximo lead novo vai para Guilherme.
    expect((await atribuir(repo, 'la2')).responsavel.id).toBe('guilherme')
    expect(repo.handoffs(ORG_A).filter((h) => h.leadId === 'la1')).toHaveLength(2)
  })

  it('8. comercial fora do rodízio (férias) mantém o ownership histórico', async () => {
    const repo = cenario()
    const primeiro = await atribuir(repo, 'la1') // Bruno
    repo.encerrarHandoff(primeiro.handoff.id)
    repo.participar(ORG_A, 'bruno', false)
    const r = await atribuir(repo, 'la1', 'ev-2')
    expect(r.motivo).toBe('reativacao')
    expect(r.responsavel.id).toBe('bruno')
    expect(repo.cursor(ORG_A).versao).toBe(1)
  })

  it('responsável anterior removido da equipe → não é preservável: round-robin, mas não é 1ª atribuição', async () => {
    const repo = cenario()
    const primeiro = await atribuir(repo, 'la1') // Bruno
    repo.encerrarHandoff(primeiro.handoff.id)
    repo.removerUsuario('bruno')
    const r = await atribuir(repo, 'la1', 'ev-2')
    expect(r.motivo).toBe('round_robin')
    expect(r.primeiraAtribuicao).toBe(false)
    expect(r.responsavel.id).toBe('guilherme') // próximo na ordem (Bruno saiu)
  })

  it('responsável anterior desativado (usuarios.ativo=false) → round-robin', async () => {
    const repo = cenario()
    const primeiro = await atribuir(repo, 'la1')
    repo.encerrarHandoff(primeiro.handoff.id)
    repo.desativarUsuario('bruno')
    const r = await atribuir(repo, 'la1', 'ev-2')
    expect(r.motivo).toBe('round_robin')
    expect(r.responsavel.id).not.toBe('bruno')
  })
})

describe('handoff — idempotência', () => {
  it('9/10. o mesmo evento duas vezes → mesmo registro, mesmo responsável, cursor parado', async () => {
    const repo = cenario()
    const a = await atribuir(repo, 'la1', 'ev-x')
    const b = await atribuirResponsavelHandoff(repo, entrada('la1', 'ev-x'))
    expect(b.tipo).toBe('ja_processado')
    if (b.tipo !== 'ja_processado') return
    expect(b.handoff.id).toBe(a.handoff.id)
    expect(b.handoff.responsavelId).toBe(a.responsavel.id)
    expect(repo.handoffs(ORG_A)).toHaveLength(1)
    expect(repo.cursor(ORG_A).versao).toBe(1)
    expect(repo.lead('la1')?.responsavelId).toBe(a.responsavel.id)
  })

  it('14. lead já em contato comercial com OUTRO evento → não redistribui', async () => {
    const repo = cenario()
    const a = await atribuir(repo, 'la1', 'ev-1')
    const b = await atribuirResponsavelHandoff(repo, entrada('la1', 'ev-2'))
    expect(b.tipo).toBe('ja_em_contato_comercial')
    expect(repo.handoffs(ORG_A)).toHaveLength(1)
    expect(repo.cursor(ORG_A).versao).toBe(1)
    expect(repo.lead('la1')?.responsavelId).toBe(a.responsavel.id)
  })

  it('evento duplicado em corrida (os dois passam pela checagem inicial) → só um confirma', async () => {
    const repo = cenario()
    // Segura os dois na leitura do cursor até ambos terem lido o mesmo estado.
    let chegaram = 0
    let liberar!: () => void
    const barreira = new Promise<void>((res) => { liberar = res })
    repo.hooks.aoLerCursor = async () => { if (++chegaram === 2) liberar(); await barreira }
    const [a, b] = await Promise.all([
      atribuirResponsavelHandoff(repo, entrada('la1', 'ev-x')),
      atribuirResponsavelHandoff(repo, entrada('la1', 'ev-x')),
    ])
    const tipos = [a.tipo, b.tipo].sort()
    expect(tipos).toEqual(['atribuido', 'ja_processado'])
    expect(repo.handoffs(ORG_A)).toHaveLength(1)
    expect(repo.cursor(ORG_A).versao).toBe(1)
  })
})

describe('handoff — concorrência', () => {
  it('11. dois handoffs simultâneos decidindo sobre o MESMO cursor → Bruno e Guilherme, nunca os dois Bruno', async () => {
    const repo = cenario()
    let chegaram = 0
    let liberar!: () => void
    const barreira = new Promise<void>((res) => { liberar = res })
    repo.hooks.aoLerCursor = async () => { if (++chegaram === 2) liberar(); await barreira }

    const [a, b] = await Promise.all([atribuir(repo, 'la1'), atribuir(repo, 'la2')])
    const ids = [a.responsavel.id, b.responsavel.id].sort()
    expect(ids).toEqual(['bruno', 'guilherme'])
    expect(repo.cursor(ORG_A).versao).toBe(2)
    expect(repo.handoffs(ORG_A)).toHaveLength(2)
  })

  it('participante desativado entre a decisão e a confirmação → redecide, ninguém recebe lead indevido', async () => {
    const repo = cenario()
    let vezes = 0
    repo.hooks.antesDeConfirmar = async (_e, d) => {
      // Na 1ª tentativa o escolhido (Bruno) sai do rodízio "no meio".
      if (++vezes === 1 && d.responsavelId === 'bruno') repo.participar(ORG_A, 'bruno', false)
    }
    const r = await atribuir(repo, 'la1')
    expect(r.responsavel.id).toBe('guilherme')
    expect(vezes).toBe(2)
    expect(repo.cursor(ORG_A)).toEqual({ ultimoUsuarioId: 'guilherme', versao: 1 })
  })

  it('conflito persistente esgota as tentativas sem gravar nada', async () => {
    const repo = cenario()
    // Antes de CADA confirmação, outra distribuição avança o cursor "por fora"
    // (carga extrema): a decisão do nosso handoff envelhece sempre.
    let vezes = 0
    const gancho = async () => {
      vezes++
      const c = repo.cursor(ORG_A)
      repo.hooks.antesDeConfirmar = undefined // o avanço externo não se auto-intercepta
      await repo.confirmar(
        { organizacaoId: ORG_A, leadId: `la${vezes + 1}`, eventoId: `ev-fora-${vezes}`, origem: 'manual' },
        { responsavelId: 'guilherme', motivo: 'round_robin', primeiraAtribuicao: true, cursorVersaoEsperada: c.versao },
      )
      repo.hooks.antesDeConfirmar = gancho
    }
    repo.hooks.antesDeConfirmar = gancho
    const r = await atribuirResponsavelHandoff(repo, entrada('la1'))
    expect(r.tipo).toBe('conflito_concorrencia')
    expect(vezes).toBe(MAX_TENTATIVAS_HANDOFF)
    expect(repo.handoffs(ORG_A).some((h) => h.leadId === 'la1')).toBe(false)
    expect(repo.lead('la1')?.responsavelId).toBe('sdr-importador')
  })
})

describe('handoff — sem comercial disponível', () => {
  it('12. ninguém participa → aguardando_distribuicao, registro pendente, lead e cursor intactos', async () => {
    const repo = cenario()
    for (const u of ['bruno', 'silmara', 'guilherme']) repo.participar(ORG_A, u, false)
    const r = await atribuirResponsavelHandoff(repo, entrada('la1'))
    expect(r.tipo).toBe('aguardando_distribuicao')
    if (r.tipo !== 'aguardando_distribuicao') return
    expect(r.handoff.status).toBe('aguardando_distribuicao')
    expect(r.handoff.responsavelId).toBeNull()
    expect(repo.lead('la1')?.responsavelId).toBe('sdr-importador') // não escolhe admin/aleatório
    expect(repo.cursor(ORG_A).versao).toBe(0)
    // Repetir sem mudança → mesmo registro pendente, sem duplicar.
    const de_novo = await atribuirResponsavelHandoff(repo, entrada('la1'))
    expect(de_novo.tipo).toBe('aguardando_distribuicao')
    expect(repo.handoffs(ORG_A)).toHaveLength(1)
  })

  it('pendente é recuperável: quando alguém volta a participar, a mesma chamada conclui o handoff', async () => {
    const repo = cenario()
    for (const u of ['bruno', 'silmara', 'guilherme']) repo.participar(ORG_A, u, false)
    const pendente = await atribuirResponsavelHandoff(repo, entrada('la1'))
    expect(pendente.tipo).toBe('aguardando_distribuicao')
    await definirParticipacaoComercial(repo, ORG_A, 'silmara', true)
    const r = await atribuir(repo, 'la1')
    expect(r.responsavel.id).toBe('silmara')
    expect(r.motivo).toBe('round_robin')
    expect(r.primeiraAtribuicao).toBe(true)
    // Completa o MESMO registro (não cria outro).
    expect(repo.handoffs(ORG_A)).toHaveLength(1)
    expect(r.handoff.id).toBe(pendente.tipo === 'aguardando_distribuicao' ? pendente.handoff.id : '')
    expect(r.handoff.status).toBe('em_contato_comercial')
  })
})

describe('handoff — falhas parciais', () => {
  it('13a. falha depois de avançar o cursor → cursor volta, sem registro, lead intacto', async () => {
    const repo = cenario()
    repo.hooks.falharEm = 'apos_cursor'
    await expect(atribuirResponsavelHandoff(repo, entrada('la1'))).rejects.toThrow(/falha injetada/)
    expect(repo.cursor(ORG_A)).toEqual({ ultimoUsuarioId: null, versao: 0 })
    expect(repo.handoffs(ORG_A)).toHaveLength(0)
    expect(repo.lead('la1')?.responsavelId).toBe('sdr-importador')
    // Depois que o banco volta, o próximo handoff é o PRIMEIRO da ordem (nada foi consumido).
    repo.hooks.falharEm = null
    expect((await atribuir(repo, 'la1')).responsavel.id).toBe('bruno')
  })

  it('13b. falha depois do registro (antes do lead) → nada fica pela metade', async () => {
    const repo = cenario()
    repo.hooks.falharEm = 'apos_registro'
    await expect(atribuirResponsavelHandoff(repo, entrada('la1'))).rejects.toThrow(/falha injetada/)
    expect(repo.cursor(ORG_A).versao).toBe(0)
    expect(repo.handoffs(ORG_A)).toHaveLength(0)
    expect(repo.lead('la1')?.responsavelId).toBe('sdr-importador')
  })
})

describe('handoff — validação de entrada e configuração', () => {
  it('rejeita entrada sem eventoId/origem válida (é a identidade da idempotência)', async () => {
    const repo = cenario()
    await expect(atribuirResponsavelHandoff(repo, { ...entrada('la1'), eventoId: '' })).rejects.toThrow(/eventoId/)
    await expect(atribuirResponsavelHandoff(repo, { ...entrada('la1'), origem: 'hubspot_followup' as never })).rejects.toThrow(/origem/)
    expect(repo.handoffs()).toHaveLength(0)
  })

  it('listar mostra todos os comerciais ativos da org com a flag; definir só aceita usuário da org', async () => {
    const repo = cenario()
    const lista = await listarDistribuicaoComercial(repo, ORG_A)
    expect(lista.map((c) => [c.nome, c.participa])).toEqual([
      ['Bruno', true], ['Guilherme', true], ['João', false], ['Silmara', true],
    ])
    expect(await definirParticipacaoComercial(repo, ORG_A, 'ana-b', true)).toBe('usuario_nao_encontrado')
    expect((await listarDistribuicaoComercial(repo, ORG_B)).map((c) => c.usuarioId)).toEqual(['ana-b', 'caio-b'])
  })

  it('desativar participação não remove ownership dos leads já atribuídos', async () => {
    const repo = cenario()
    const r = await atribuir(repo, 'la1') // Bruno
    await definirParticipacaoComercial(repo, ORG_A, 'bruno', false)
    expect(repo.lead('la1')?.responsavelId).toBe(r.responsavel.id)
    expect(repo.handoffs(ORG_A)[0].responsavelId).toBe('bruno')
  })
})
