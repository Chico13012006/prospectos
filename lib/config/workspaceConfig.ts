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
export const WORKSPACE_CONFIG_SCHEMA_VERSION = 2

// Configuração de visibilidade de um campo por workspace (Personalização > Campos).
export interface CampoUI {
  chave: string       // coluna no banco (ex: 'empresa', 'data_validade')
  label: string       // nome exibido na UI
  obrigatorio: boolean
  visivel: boolean    // aparece nas listagens (Base de Leads, Pipeline)
  filtro: boolean     // aparece como filtro disponível
}

// Campos padrão (mockup Personalização > Campos). Ausência = padrão ativo.
export const CAMPOS_UI_PADRAO: CampoUI[] = [
  { chave: 'contato_nome',    label: 'Nome do contato',    obrigatorio: true,  visivel: true,  filtro: false },
  { chave: 'empresa',         label: 'Empresa',             obrigatorio: true,  visivel: true,  filtro: false },
  { chave: 'contato_email',   label: 'E-mail',              obrigatorio: false, visivel: true,  filtro: false },
  { chave: 'contato_telefone',label: 'Telefone',            obrigatorio: false, visivel: false, filtro: false },
  { chave: 'origem',          label: 'Origem',              obrigatorio: false, visivel: false, filtro: false },
  { chave: 'responsavel_id',  label: 'Responsável',         obrigatorio: false, visivel: true,  filtro: true  },
  { chave: 'estagio',         label: 'Status do contato',   obrigatorio: false, visivel: true,  filtro: true  },
  { chave: 'data_validade',   label: 'Validade do laudo',   obrigatorio: false, visivel: true,  filtro: false },
  { chave: 'proxima_acao_data', label: 'Próximo follow-up', obrigatorio: false, visivel: false, filtro: false },
  { chave: 'score',           label: 'Score',               obrigatorio: false, visivel: true,  filtro: false },
]

// Resolve config efetiva: mescla padrão com overrides gravados.
export function camposUIEfetivos(gravados?: CampoUI[]): CampoUI[] {
  if (!gravados?.length) return CAMPOS_UI_PADRAO
  const mapa = new Map(gravados.map((c) => [c.chave, c]))
  return CAMPOS_UI_PADRAO.map((p) => mapa.get(p.chave) ?? p)
}

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
  // Configuração de campos por workspace (Personalização > Campos). Ausência = todos no padrão.
  camposUI?: CampoUI[]
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
  // v1 -> v2: adiciona camposUI (Personalização). Nada a migrar, ausência = padrão.
  if (v < 2) cfg = { ...cfg, _schema_version: 2 }
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
  if (Array.isArray(obj.camposUI)) {
    out.camposUI = (obj.camposUI as unknown[]).filter(ehObjeto).map((c) => ({
      chave: String(c.chave ?? ''),
      label: String(c.label ?? ''),
      obrigatorio: c.obrigatorio === true,
      visivel: c.visivel !== false,
      filtro: c.filtro === true,
    })).filter((c) => c.chave)
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

// Campos editáveis pela tela Configurações (Processo comercial + Personalização).
// Um patch achatado e amigável à UI; a mescla preserva o resto do blob e passa
// pelo ponto único de escrita (validação/versão).
export interface WorkspaceConfigEditavel {
  nomenclaturas?: Record<string, string>
  modulos?: Record<string, boolean>
  renovacaoAntecedenciaDias?: number
  roiCustoMensal?: number
  camposUI?: CampoUI[]
}

export function mesclarWorkspaceConfig(atual: WorkspaceConfig, patch: WorkspaceConfigEditavel): WorkspaceConfig {
  const next: Partial<WorkspaceConfig> = { ...atual }
  if (patch.nomenclaturas) next.nomenclaturas = patch.nomenclaturas
  if (patch.modulos) next.modulos = patch.modulos
  if (typeof patch.renovacaoAntecedenciaDias === 'number' && patch.renovacaoAntecedenciaDias >= 0) {
    next.renovacao = { ...atual.renovacao, antecedenciaDias: patch.renovacaoAntecedenciaDias }
  }
  if (typeof patch.roiCustoMensal === 'number' && patch.roiCustoMensal >= 0) {
    next.roi = { ...atual.roi, custoMensal: patch.roiCustoMensal }
  }
  if (Array.isArray(patch.camposUI)) next.camposUI = patch.camposUI
  return serializeWorkspaceConfig(next)
}
