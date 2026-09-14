import { describe, expect, it, vi } from 'vitest'
import {
  aplicarEstagioRenovacao,
  montarBackupEstagioRenovacao,
  reverterEstagioRenovacao,
  type BackupEstagioRenovacao,
  type ClienteSql,
} from '../aplicarEstagioRenovacao'

const ORG = '11111111-1111-4111-8111-111111111111'
const ESTAGIOS_ENTRADA = ['novos_leads', 'novo', 'primeiro_contato']
const ESCRITA = /\b(update|insert|delete|truncate|alter|drop|create)\b|for update/i

interface Chamada { sql: string; params?: unknown[] }

const etapa = (sql: string) => /\/\* estagio-renovacao:([a-z-]+) \*\//.exec(sql)?.[1] ?? sql.trim()
const idLead = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function clienteFalso(opts: { candidatos?: number; hashDepois?: Record<string, string> } = {}) {
  const chamadas: Chamada[] = []
  const n = opts.candidatos ?? 3
  const ids = Array.from({ length: n }, (_, i) => idLead(i + 1))
  let gravou = false
  const db: ClienteSql = {
    async query(sql, params) {
      chamadas.push({ sql, params })
      const passo = etapa(sql)
      switch (passo) {
        case 'org':
          return { rows: [{ id: ORG, nome: 'Org Teste', configuracoes: {} }] }
        case 'totais':
          return { rows: [{ total: 10, com_validade: n + 1, sem_validade: 9 - n }] }
        case 'distribuicao':
          return { rows: [{ estagio: 'primeiro_contato', leads: n }, { estagio: 'follow_up', leads: 1 }] }
        case 'candidatos':
          return { rows: ids.map((id, i) => ({ id, empresa: `Empresa ${i + 1}`, estagio: 'primeiro_contato', owner: 'engine', data_validade: '2026-10-01' })) }
        case 'impressao-sem-validade':
        case 'impressao-org-fora-do-alvo':
        case 'impressao-outras-orgs':
        case 'impressao-alvo':
          return { rows: [{ total: passo === 'impressao-outras-orgs' ? 7 : 1, hash: gravou && opts.hashDepois?.[passo] ? opts.hashDepois[passo] : `hash-${passo}` }] }
        case 'atualizar':
          gravou = true
          return { rows: ids.map((id) => ({ id })) }
        case 'conferir-alvo':
          return { rows: [{ total: n }] }
        case 'contar-renovacao':
          return { rows: [{ total: n }] }
        default:
          return { rows: [] }
      }
    },
  }
  return { db, chamadas, ids }
}

describe('aplicar-estagio-renovacao — simulação (padrão)', () => {
  it('não escreve nada: transação somente leitura, só leituras e ROLLBACK', async () => {
    const { db, chamadas } = clienteFalso()

    const r = await aplicarEstagioRenovacao(db, { org: ORG })

    expect(chamadas[0].sql).toBe('BEGIN TRANSACTION READ ONLY')
    expect(chamadas.at(-1)?.sql).toBe('ROLLBACK')
    expect(chamadas.some((c) => ESCRITA.test(c.sql))).toBe(false)
    expect(chamadas.map((c) => c.sql)).not.toContain('COMMIT')
    expect(r.modo).toBe('simulacao')
    expect(r.gravacao).toBeUndefined()
  })

  it('filtra pela organização informada e só pelos estágios de entrada; relata o plano', async () => {
    const { db, chamadas, ids } = clienteFalso()

    const r = await aplicarEstagioRenovacao(db, { org: ORG })

    const candidatos = chamadas.find((c) => etapa(c.sql) === 'candidatos')
    expect(candidatos?.sql).toMatch(/organizacao_id = \$1 and data_validade is not null and estagio = any\(\$2::text\[\]\)/)
    expect(candidatos?.params).toEqual([ORG, ESTAGIOS_ENTRADA])
    for (const chamada of chamadas.filter((c) => c.params)) expect(chamada.params?.[0]).toBe(ORG)
    expect(r.candidatos.map((c) => [c.id, c.estagio])).toEqual(ids.map((id) => [id, 'primeiro_contato']))
    expect(r.totais).toEqual({ total: 10, comValidade: 4, semValidade: 6 })
    expect(r.comValidadeForaDoFiltro).toBe(1)
    expect(r.leadsOutrasOrganizacoes).toBe(7)
  })

  it('recusa organização que não é uuid antes de abrir transação', async () => {
    const { db, chamadas } = clienteFalso()
    await expect(aplicarEstagioRenovacao(db, { org: 'laudos' })).rejects.toThrow('uuid')
    expect(chamadas).toHaveLength(0)
  })
})

describe('aplicar-estagio-renovacao — gravação (--confirmar)', () => {
  it('exige --esperado antes de qualquer consulta', async () => {
    const { db, chamadas } = clienteFalso()
    await expect(aplicarEstagioRenovacao(db, { org: ORG, confirmar: true })).rejects.toThrow('--esperado')
    expect(chamadas).toHaveLength(0)
  })

  it('quantidade diferente da esperada: ROLLBACK, sem UPDATE e sem backup', async () => {
    const { db, chamadas } = clienteFalso({ candidatos: 3 })
    const antesDeGravar = vi.fn()

    await expect(aplicarEstagioRenovacao(db, { org: ORG, confirmar: true, esperado: 29, antesDeGravar }))
      .rejects.toThrow('Esperava 29 lead(s), encontrei 3')

    expect(chamadas.some((c) => etapa(c.sql) === 'atualizar')).toBe(false)
    expect(chamadas.at(-1)?.sql).toBe('ROLLBACK')
    expect(antesDeGravar).not.toHaveBeenCalled()
  })

  it('trava as linhas, chama o backup antes do UPDATE, altera só estagio dos IDs planejados e faz COMMIT', async () => {
    const { db, chamadas, ids } = clienteFalso({ candidatos: 3 })
    let chamadasNoBackup = -1

    const r = await aplicarEstagioRenovacao(db, {
      org: ORG,
      confirmar: true,
      esperado: 3,
      antesDeGravar: () => { chamadasNoBackup = chamadas.length },
    })

    expect(chamadas[0].sql).toBe('BEGIN')
    expect(chamadas.find((c) => etapa(c.sql) === 'candidatos')?.sql).toMatch(/for update$/)
    const indiceUpdate = chamadas.findIndex((c) => etapa(c.sql) === 'atualizar')
    expect(chamadasNoBackup).toBeGreaterThan(0)
    expect(chamadasNoBackup).toBeLessThanOrEqual(indiceUpdate)
    expect(chamadas[indiceUpdate].sql).toMatch(/update leads set estagio = \$3\s+where organizacao_id = \$1 and data_validade is not null/)
    expect(chamadas[indiceUpdate].params).toEqual([ORG, ESTAGIOS_ENTRADA, 'renovacao', ids])
    expect(chamadas.map((c) => c.sql)).toContain('COMMIT')
    expect(chamadas.map((c) => c.sql)).not.toContain('ROLLBACK')
    expect(r.gravacao).toEqual({ alterados: 3, renovacaoNaOrganizacao: 3 })
  })

  it.each([
    'impressao-sem-validade',
    'impressao-org-fora-do-alvo',
    'impressao-outras-orgs',
    'impressao-alvo',
  ])('divergência em %s após o UPDATE: ROLLBACK e nada gravado', async (passo) => {
    const { db, chamadas } = clienteFalso({ hashDepois: { [passo]: 'mudou' } })

    await expect(aplicarEstagioRenovacao(db, { org: ORG, confirmar: true, esperado: 3 })).rejects.toThrow('ROLLBACK')

    expect(chamadas.at(-1)?.sql).toBe('ROLLBACK')
    expect(chamadas.map((c) => c.sql)).not.toContain('COMMIT')
  })
})

describe('aplicar-estagio-renovacao — backup e reversão', () => {
  const A = idLead(1)
  const B = idLead(2)
  const backup: BackupEstagioRenovacao = {
    tipo: 'estagio-renovacao',
    org: ORG,
    geradoEm: '2026-09-14T00:00:00.000Z',
    leads: [
      { id: A, empresa: 'Empresa A', estagioAnterior: 'primeiro_contato' },
      { id: B, empresa: 'Empresa B', estagioAnterior: 'novos_leads' },
    ],
  }

  function clienteReversao() {
    const chamadas: Chamada[] = []
    const db: ClienteSql = {
      async query(sql, params) {
        chamadas.push({ sql, params })
        if (etapa(sql) === 'reverter-atuais') return { rows: [{ id: A, estagio: 'renovacao' }, { id: B, estagio: 'follow_up' }] }
        if (etapa(sql) === 'reverter') return { rows: [{ id: A }] }
        return { rows: [] }
      },
    }
    return { db, chamadas }
  }

  it('o backup guarda id, empresa e estágio anterior de cada alvo', async () => {
    const { db } = clienteFalso({ candidatos: 2 })
    const plano = await aplicarEstagioRenovacao(db, { org: ORG })
    expect(montarBackupEstagioRenovacao(plano, 'agora')).toEqual({
      tipo: 'estagio-renovacao',
      org: ORG,
      geradoEm: 'agora',
      leads: [
        { id: idLead(1), empresa: 'Empresa 1', estagioAnterior: 'primeiro_contato' },
        { id: idLead(2), empresa: 'Empresa 2', estagioAnterior: 'primeiro_contato' },
      ],
    })
  })

  it('simulação da reversão não escreve e preserva quem foi movido depois', async () => {
    const { db, chamadas } = clienteReversao()

    const r = await reverterEstagioRenovacao(db, { org: ORG, backup })

    expect(r.revertiveis.map((lead) => lead.id)).toEqual([A])
    expect(r.preservados).toEqual([{ id: B, estagioAtual: 'follow_up' }])
    expect(chamadas[0].sql).toBe('BEGIN TRANSACTION READ ONLY')
    expect(chamadas.at(-1)?.sql).toBe('ROLLBACK')
    expect(chamadas.some((c) => ESCRITA.test(c.sql))).toBe(false)
  })

  it('reversão confirmada volta só quem ainda está em renovacao ao estágio anterior', async () => {
    const { db, chamadas } = clienteReversao()

    const r = await reverterEstagioRenovacao(db, { org: ORG, backup, confirmar: true })

    const update = chamadas.find((c) => etapa(c.sql) === 'reverter')
    expect(update?.params).toEqual([ORG, [A], ['primeiro_contato'], 'renovacao'])
    expect(chamadas.at(-1)?.sql).toBe('COMMIT')
    expect(r.revertidos).toBe(1)
  })

  it('recusa backup de outra organização ou com estágio anterior fora da lista', async () => {
    const { db, chamadas } = clienteReversao()
    await expect(reverterEstagioRenovacao(db, { org: idLead(9), backup })).rejects.toThrow('outra organização')
    await expect(reverterEstagioRenovacao(db, {
      org: ORG,
      backup: { ...backup, leads: [{ id: A, empresa: 'A', estagioAnterior: 'ganho' }] },
    })).rejects.toThrow('Backup inválido')
    expect(chamadas).toHaveLength(0)
  })
})
