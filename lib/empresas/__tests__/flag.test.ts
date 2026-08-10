import { describe, it, expect, afterEach } from 'vitest'
import { leituraEntidadesLigada } from '../flag'

const ORG_LAUDOS = '03097614-9fd5-4491-a91c-589f84461683'
const ORG_PADRAO = '00000000-0000-0000-0000-000000000001'

const salvo = { reads: process.env.EMPRESA_CONTATO_READS, orgs: process.env.EMPRESA_CONTATO_READS_ORGS }
function setEnv(reads?: string, orgs?: string) {
  if (reads === undefined) delete process.env.EMPRESA_CONTATO_READS; else process.env.EMPRESA_CONTATO_READS = reads
  if (orgs === undefined) delete process.env.EMPRESA_CONTATO_READS_ORGS; else process.env.EMPRESA_CONTATO_READS_ORGS = orgs
}
afterEach(() => setEnv(salvo.reads, salvo.orgs))

describe('leituraEntidadesLigada — flag por tela e por org', () => {
  it('vazio => legado (off) em qualquer tela/org', () => {
    setEnv(undefined, undefined)
    expect(leituraEntidadesLigada('lead-panel', ORG_LAUDOS)).toBe(false)
  })

  it('"all" liga em qualquer tela', () => {
    setEnv('all', undefined)
    expect(leituraEntidadesLigada('lead-panel')).toBe(true)
    expect(leituraEntidadesLigada('base-leads')).toBe(true)
  })

  it('CSV liga só nas telas nomeadas', () => {
    setEnv('lead-panel', undefined)
    expect(leituraEntidadesLigada('lead-panel')).toBe(true)
    expect(leituraEntidadesLigada('base-leads')).toBe(false)
  })

  it('restrição por org: liga só na org de Laudos', () => {
    setEnv('lead-panel', ORG_LAUDOS)
    expect(leituraEntidadesLigada('lead-panel', ORG_LAUDOS)).toBe(true)
    expect(leituraEntidadesLigada('lead-panel', ORG_PADRAO)).toBe(false)
    expect(leituraEntidadesLigada('lead-panel')).toBe(false) // sem org informada + restrição => off
  })

  it('sem restrição de org => liga em todas', () => {
    setEnv('lead-panel', '')
    expect(leituraEntidadesLigada('lead-panel', ORG_PADRAO)).toBe(true)
    expect(leituraEntidadesLigada('lead-panel', ORG_LAUDOS)).toBe(true)
  })

  // Reproduz o CAMINHO REAL de produção: env exatamente como cadastrada na Vercel.
  // A sessão de Laudos vê os cartões; a sessão da Org Padrão (ex.: franrufs13)
  // NÃO vê — que era exatamente o sintoma relatado.
  it('caminho de produção: só a sessão de Laudos vê os cartões', () => {
    setEnv('lead-panel', ORG_LAUDOS)
    expect(leituraEntidadesLigada('lead-panel', ORG_LAUDOS)).toBe(true)
    expect(leituraEntidadesLigada('lead-panel', ORG_PADRAO)).toBe(false)
  })

  it('robustez: valor colado com espaço/nova-linha e org em CAIXA diferente ainda casa', () => {
    setEnv(' lead-panel \n', `\n  ${ORG_LAUDOS.toUpperCase()}  `)
    expect(leituraEntidadesLigada('lead-panel', ORG_LAUDOS)).toBe(true)
    expect(leituraEntidadesLigada('lead-panel', ORG_PADRAO)).toBe(false)
  })
})
