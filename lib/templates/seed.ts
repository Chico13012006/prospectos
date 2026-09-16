// Carga dos templates-base (lib/engine/templates-seed.ts) em UMA organização.
//
// Substitui o seed antigo, que apagava a tabela `templates` inteira — de todas
// as organizações — e reinseria as linhas sem organizacao_id. Regras agora:
//   - organização explícita, UUID válido e existente; sem ela nada executa;
//   - ensaio por padrão: sem `confirmar`, nenhuma escrita;
//   - só INSERE as chaves (canal, segmento, estágio) que a organização ainda
//     não tem; nunca apaga e nunca sobrescreve o que ela já editou;
//   - toda leitura e escrita filtra/grava organizacao_id: o client do script é
//     service_role e ignora RLS.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SeedTemplate } from '@/lib/engine/templates-seed'
import { ehUuid } from './tipos'

export class ErroSeedTemplates extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ErroSeedTemplates'
  }
}

export function lerOrganizacaoAlvo(argv: readonly string[]): string {
  let valor: string | undefined
  argv.forEach((arg, indice) => {
    if (arg.startsWith('--org=')) valor = arg.slice('--org='.length)
    else if (arg === '--org') valor = argv[indice + 1]
  })
  const org = valor?.trim()
  if (!org) {
    throw new ErroSeedTemplates('Informe a organização alvo com --org=<uuid>. Sem organização explícita nada é executado.')
  }
  if (!ehUuid(org)) throw new ErroSeedTemplates(`Organização inválida: "${org}". Use o UUID da organização.`)
  return org.toLowerCase()
}

interface ChaveTemplate {
  canal: string | null
  nicho: string | null
  tipo: string
}

const chave = (t: ChaveTemplate): string => `${t.canal ?? ''}|${t.nicho ?? ''}|${t.tipo}`

// Quais templates-base a organização ainda não tem. Um template existente com a
// mesma chave — ativo ou não, editado ou não — nunca é recriado nem tocado.
export function planejarSeedTemplates(
  existentes: readonly ChaveTemplate[],
  seed: readonly SeedTemplate[],
): SeedTemplate[] {
  const ocupadas = new Set(existentes.map(chave))
  const inserir: SeedTemplate[] = []
  for (const template of seed) {
    const k = chave(template)
    if (ocupadas.has(k)) continue
    ocupadas.add(k)
    inserir.push(template)
  }
  return inserir
}

export interface RelatorioSeedTemplates {
  organizacaoId: string
  organizacaoNome: string
  confirmado: boolean
  existentesNaOrganizacao: number
  aInserir: Pick<SeedTemplate, 'canal' | 'nicho' | 'tipo' | 'nome'>[]
  inseridos: number
}

export async function executarSeedTemplates(
  client: SupabaseClient,
  opcoes: { organizacaoId: string; confirmar: boolean; seed: readonly SeedTemplate[] },
): Promise<RelatorioSeedTemplates> {
  const org = opcoes.organizacaoId?.trim().toLowerCase()
  if (!ehUuid(org)) throw new ErroSeedTemplates('Organização alvo ausente ou inválida; nada foi executado.')

  const { data: organizacao, error: erroOrganizacao } = await client
    .from('organizacoes')
    .select('id, nome')
    .eq('id', org)
    .maybeSingle()
  if (erroOrganizacao) throw new ErroSeedTemplates(`Falha ao conferir a organização: ${erroOrganizacao.message}`)
  if (!organizacao) throw new ErroSeedTemplates(`Organização ${org} não encontrada; nada foi executado.`)

  const { data: existentes, error: erroExistentes } = await client
    .from('templates')
    .select('canal, nicho, tipo')
    .eq('organizacao_id', org)
  if (erroExistentes) throw new ErroSeedTemplates(`Falha ao ler os templates da organização: ${erroExistentes.message}`)

  const inserir = planejarSeedTemplates((existentes ?? []) as ChaveTemplate[], opcoes.seed)
  const relatorio: RelatorioSeedTemplates = {
    organizacaoId: org,
    organizacaoNome: String((organizacao as { nome?: unknown }).nome ?? ''),
    confirmado: opcoes.confirmar,
    existentesNaOrganizacao: existentes?.length ?? 0,
    aInserir: inserir.map(({ canal, nicho, tipo, nome }) => ({ canal, nicho, tipo, nome })),
    inseridos: 0,
  }
  if (!opcoes.confirmar || inserir.length === 0) return relatorio

  const { data: inseridas, error: erroInsercao } = await client
    .from('templates')
    .insert(inserir.map((t) => ({
      organizacao_id: org,
      canal: t.canal,
      nicho: t.nicho,
      tipo: t.tipo,
      nome: t.nome,
      assunto: t.assunto,
      corpo: t.corpo,
      ativo: true,
      taxa_resposta: 0,
    })))
    .select('id')
  if (erroInsercao) throw new ErroSeedTemplates(`Falha ao inserir templates: ${erroInsercao.message}`)
  return { ...relatorio, inseridos: inseridas?.length ?? 0 }
}
