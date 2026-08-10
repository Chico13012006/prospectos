import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { leituraEntidadesLigada, leituraEntidadesLigadaConfig } from '../flag'
import { serializeWorkspaceConfig, parseWorkspaceConfig } from '@/lib/config/workspaceConfig'

// Client falso: devolve o blob `configuracoes` cadastrado por org (ou null se a
// org não existe). Só implementa o caminho usado pela flag: from('organizacoes')
// .select('configuracoes').eq('id', org).maybeSingle().
function clientComConfigs(porOrg: Record<string, unknown>) {
  return {
    from() {
      let orgId: string | null = null
      const chain = {
        select: () => chain,
        eq: (col: string, val: string) => { if (col === 'id') orgId = val; return chain },
        maybeSingle: () =>
          Promise.resolve({
            data: orgId && orgId in porOrg ? { configuracoes: porOrg[orgId] } : null,
            error: null,
          }),
      }
      return chain
    },
  } as unknown as SupabaseClient
}

const ORG_ON = '03097614-9fd5-4491-a91c-589f84461683'  // Laudos (feature ligada)
const ORG_OFF = '00000000-0000-0000-0000-000000000001' // Padrão (feature desligada)

describe('leituraEntidadesLigadaConfig — regra pura sobre a config da org', () => {
  it('feature ausente => off (default seguro / legado)', () => {
    expect(leituraEntidadesLigadaConfig(parseWorkspaceConfig({}))).toBe(false)
  })
  it('empresaContatoReads=true => on', () => {
    const cfg = serializeWorkspaceConfig({ features: { empresaContatoReads: true } })
    expect(leituraEntidadesLigadaConfig(cfg)).toBe(true)
  })
  it('empresaContatoReads=false => off', () => {
    const cfg = serializeWorkspaceConfig({ features: { empresaContatoReads: false } })
    expect(leituraEntidadesLigadaConfig(cfg)).toBe(false)
  })
})

describe('leituraEntidadesLigada — resolvida no servidor, POR TENANT', () => {
  const configs = {
    [ORG_ON]: serializeWorkspaceConfig({ features: { empresaContatoReads: true } }),
    [ORG_OFF]: serializeWorkspaceConfig({ features: { empresaContatoReads: false } }),
  }

  it('tenant com a feature LIGADA vê (true)', async () => {
    const on = await leituraEntidadesLigada(clientComConfigs(configs), ORG_ON)
    expect(on).toBe(true)
  })

  it('tenant com a feature DESLIGADA NÃO vê (false) — isolamento por org', async () => {
    const off = await leituraEntidadesLigada(clientComConfigs(configs), ORG_OFF)
    expect(off).toBe(false)
  })

  it('mesmo binário: a MESMA chamada dá true p/ um tenant e false p/ o outro', async () => {
    const client = clientComConfigs(configs)
    expect(await leituraEntidadesLigada(client, ORG_ON)).toBe(true)
    expect(await leituraEntidadesLigada(client, ORG_OFF)).toBe(false)
  })

  it('org sem blob / inexistente => off (nunca liga por omissão)', async () => {
    const off = await leituraEntidadesLigada(clientComConfigs({}), ORG_ON)
    expect(off).toBe(false)
  })
})
