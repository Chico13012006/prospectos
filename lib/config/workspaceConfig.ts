// Disciplina do blob `organizacoes.configuracoes` (jsonb, migration 0014).
//
// REGRA: este blob guarda SÓ preferências FLEXÍVEIS por workspace — coisas que
// variam livremente e não valem uma tabela (widgets visíveis no dashboard,
// nomenclaturas comerciais seguras, toggles de módulo). Nada ESTRUTURAL entra
// aqui: pipelines, campos customizados, permissões, oportunidades — isso é
// tabela/coluna real, com FK e RLS. Se um dado precisa de integridade,
// relacionamento ou query, ele NÃO é preferência flexível.
//
// Disciplina obrigatória (pedido do Chico):
//   - schema tipado (WorkspaceConfig)
//   - validação na escrita (serializeWorkspaceConfig é o ÚNICO ponto de escrita)
//   - versionamento do próprio blob (_schema_version) com migração entre versões
// Sem dependência externa: validação enxuta à mão (o schema é pequeno e cresce
// junto com as fases). Se a superfície crescer muito, aí sim avaliamos um zod.

// Suba este número ao mudar o formato do blob, e adicione o passo em `migrar()`.
export const WORKSPACE_CONFIG_SCHEMA_VERSION = 1

export interface RenovacaoConfig {
  antecedenciaDias?: number       // janela: cria a tarefa N dias antes do vencimento
  templateTipo?: string           // tipo de template da 1ª mensagem de renovação
  enviarPrimeiraMensagem?: boolean // se true, dispara a 1ª mensagem (gated por MODO_ENSAIO)
}

// Feature flags POR ORGANIZAÇÃO (toggle de módulo — preferência flexível, cabe no
// blob). Resolvidas SEMPRE no servidor; nunca expostas ao cliente. Ausência de
// uma chave = feature DESLIGADA (default seguro / legado). Migrou pra cá o que
// antes era env var (a resolução por env quebrou em produção).
export interface FeaturesConfig {
  empresaContatoReads?: boolean   // lê Empresa/Contato via entidades no LeadPanel
}

// ROI (Fase 8): custo operacional de referência p/ comparar com a receita das
// oportunidades ganhas. Preferência flexível (um número), cabe no blob.
export interface RoiConfig {
  custoMensal?: number
}

export interface WorkspaceConfig {
  _schema_version: number
  // Chaves das preferências. Todas OPCIONAIS — ausência = padrão do produto.
  // Crescem nas fases seguintes (dashboard, Configurações > Processo comercial).
  dashboardWidgets?: string[]
  nomenclaturas?: Record<string, string>
  modulos?: Record<string, boolean>
  features?: FeaturesConfig
  renovacao?: RenovacaoConfig
  roi?: RoiConfig
}

// Chaves de feature conhecidas (tipadas). Só estas são aceitas na leitura do
// blob — valor com tipo errado ou chave desconhecida é descartado.
const FEATURES_BOOLEANAS: (keyof FeaturesConfig)[] = ['empresaContatoReads']

// Padrões de renovação (usados quando o workspace não configurou). NÃO hardcoda
// no motor: são defaults do produto, sobrescrevíveis por org via o jsonb.
export const RENOVACAO_PADRAO: Required<RenovacaoConfig> = {
  antecedenciaDias: 45,
  templateTipo: 'renovacao_1',
  enviarPrimeiraMensagem: true,
}

// Blob de um workspace recém-criado: só a versão atual, tudo no padrão.
export function configPadrao(): WorkspaceConfig {
  return { _schema_version: WORKSPACE_CONFIG_SCHEMA_VERSION }
}

// Migra um blob de QUALQUER versão anterior para a atual. Idempotente. Blob sem
// _schema_version (ex.: o default '{}' da migration) é tratado como versão 0.
function migrar(bruto: Record<string, unknown>): Record<string, unknown> {
  const v = typeof bruto._schema_version === 'number' ? bruto._schema_version : 0
  let cfg: Record<string, unknown> = { ...bruto }
  // v0 -> v1: primeira versão formal; nada a transformar, só carimba a versão.
  if (v < 1) cfg = { ...cfg, _schema_version: 1 }
  // Futuras: if (v < 2) { ...transforma...; cfg._schema_version = 2 }
  return cfg
}

const ehObjeto = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === 'object' && !Array.isArray(x)

// Lê o blob do banco e devolve um WorkspaceConfig válido e normalizado. NUNCA
// lança: blob vazio/ inválido cai nos padrões. Migra a versão e força os tipos
// das chaves conhecidas (descarta valores com tipo errado, preserva o resto).
export function parseWorkspaceConfig(bruto: unknown): WorkspaceConfig {
  const obj = ehObjeto(bruto) ? migrar(bruto) : {}
  const out: WorkspaceConfig = { _schema_version: WORKSPACE_CONFIG_SCHEMA_VERSION }

  if (Array.isArray(obj.dashboardWidgets)) {
    out.dashboardWidgets = obj.dashboardWidgets.filter((x): x is string => typeof x === 'string')
  }
  if (ehObjeto(obj.nomenclaturas)) {
    out.nomenclaturas = Object.fromEntries(
      Object.entries(obj.nomenclaturas).filter(([, v]) => typeof v === 'string'),
    ) as Record<string, string>
  }
  if (ehObjeto(obj.modulos)) {
    out.modulos = Object.fromEntries(
      Object.entries(obj.modulos).filter(([, v]) => typeof v === 'boolean'),
    ) as Record<string, boolean>
  }
  if (ehObjeto(obj.features)) {
    const f: FeaturesConfig = {}
    for (const k of FEATURES_BOOLEANAS) {
      if (typeof obj.features[k] === 'boolean') f[k] = obj.features[k] as boolean
    }
    if (Object.keys(f).length > 0) out.features = f
  }
  if (ehObjeto(obj.roi)) {
    const r = obj.roi as Record<string, unknown>
    const roi: RoiConfig = {}
    if (typeof r.custoMensal === 'number' && r.custoMensal >= 0) roi.custoMensal = r.custoMensal
    if (Object.keys(roi).length > 0) out.roi = roi
  }
  if (ehObjeto(obj.renovacao)) {
    const r = obj.renovacao as Record<string, unknown>
    const ren: RenovacaoConfig = {}
    if (typeof r.antecedenciaDias === 'number' && r.antecedenciaDias >= 0) ren.antecedenciaDias = r.antecedenciaDias
    if (typeof r.templateTipo === 'string' && r.templateTipo) ren.templateTipo = r.templateTipo
    if (typeof r.enviarPrimeiraMensagem === 'boolean') ren.enviarPrimeiraMensagem = r.enviarPrimeiraMensagem
    if (Object.keys(ren).length > 0) out.renovacao = ren
  }
  return out
}

// Config de renovação EFETIVA de um workspace: o que ele configurou sobrepõe os
// padrões do produto. Fonte: organizacoes.configuracoes (jsonb) já parseado.
export function renovacaoEfetiva(cfg: WorkspaceConfig | null | undefined): Required<RenovacaoConfig> {
  return { ...RENOVACAO_PADRAO, ...(cfg?.renovacao ?? {}) }
}

// ÚNICO ponto de escrita: valida/normaliza e carimba a versão atual. Quem for
// gravar `organizacoes.configuracoes` DEVE passar o blob por aqui antes.
export function serializeWorkspaceConfig(cfg: Partial<WorkspaceConfig>): WorkspaceConfig {
  return parseWorkspaceConfig({ ...cfg, _schema_version: WORKSPACE_CONFIG_SCHEMA_VERSION })
}
