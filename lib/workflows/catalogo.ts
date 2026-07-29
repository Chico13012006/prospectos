// Catálogo de blocos para o builder de formulário (Fase 4 — UI).
//
// É o espelho, voltado à UI, dos blocos registrados em blocos.ts (Fase 3): para
// cada `tipo` descreve o rótulo e os campos de `config` (com padrão e opções).
// A UI monta o formulário a partir daqui; o valor gravado é sempre o
// BlocoConfig { tipo, config } que o motor entende. Adicionar um bloco à UI é
// acrescentar uma entrada aqui — mantendo os `tipo`/chaves iguais aos de blocos.ts.
//
// v1 expõe os blocos LINEARES (gatilho + condições + ações em sequência). A ação
// 'ramificar' (A/B) existe no motor mas ainda não tem editor visual — fica para
// uma iteração seguinte; workflows com ramificação podem ser autorados por script.
import type { BlocoConfig, DefinicaoWorkflow } from './types'
import { OPERADORES } from './operadores'

export type CampoTipo = 'texto' | 'numero' | 'select' | 'booleano'

export interface CampoDef {
  nome: string
  label: string
  tipo: CampoTipo
  padrao: string | number | boolean
  // Para 'select'/'booleano': valores possíveis (booleano usa 'true'/'false').
  opcoes?: { valor: string; label: string }[]
  dica?: string
}

export interface BlocoDef {
  tipo: string
  label: string
  descricao: string
  campos: CampoDef[]
  // Config inicial CUSTOM (para blocos que não são só campos planos, como
  // 'saltar_se', cujo config tem uma condição aninhada). Quando presente,
  // configPadrao a usa em vez de montar a partir de `campos`. Editada por um
  // editor dedicado na UI (o renderer genérico não cobre config aninhado).
  configInicial?: Record<string, unknown>
}

// Estágios de template conhecidos (espelham TIPO_LABEL da tela de Templates).
const TEMPLATES_OPCOES = [
  { valor: 'primeiro_contato', label: '1º contato' },
  { valor: 'follow_up_1', label: 'Follow-up 1' },
  { valor: 'follow_up_2', label: 'Follow-up 2' },
  { valor: 'follow_up_3', label: 'Follow-up 3' },
  { valor: 'follow_up_4', label: 'Follow-up 4' },
]

export const GATILHOS: BlocoDef[] = [
  {
    tipo: 'campo_data_vence',
    label: 'Data do lead vence',
    descricao: 'Inscreve o lead quando um campo de data dele vence em até N dias.',
    campos: [
      {
        nome: 'campo',
        label: 'Campo de data',
        tipo: 'texto',
        padrao: 'proxima_acao_data',
        dica: 'Coluna de data em leads (ex.: proxima_acao_data).',
      },
      { nome: 'dias', label: 'Dias de antecedência', tipo: 'numero', padrao: 0 },
    ],
  },
]

// Campos de `leads` expostos ao filtro genérico (espelham a whitelist do
// ambiente CAMPOS_LEAD_PERMITIDOS). Rótulos amigáveis; `valor` é a coluna real.
const CAMPOS_LEAD_OPCOES = [
  { valor: 'estagio', label: 'Estágio no pipeline' },
  { valor: 'segmento', label: 'Segmento' },
  { valor: 'score', label: 'Score de engajamento' },
  { valor: 'responsavel_nome', label: 'Responsável (nome)' },
  { valor: 'cidade', label: 'Cidade' },
  { valor: 'estado', label: 'Estado' },
  { valor: 'origem', label: 'Origem' },
  { valor: 'faixa_funcionarios', label: 'Faixa de funcionários' },
  { valor: 'canal_preferencial', label: 'Canal preferencial' },
  { valor: 'followups_enviados', label: 'Follow-ups enviados' },
  { valor: 'ultimo_contato', label: 'Último contato (data)' },
  { valor: 'proxima_acao_data', label: 'Próxima ação (data)' },
  { valor: 'created_at', label: 'Data de entrada' },
  { valor: 'perdido', label: 'Perdido (true/false)' },
]

export const CONDICOES: BlocoDef[] = [
  {
    tipo: 'campo',
    label: 'Campo do lead',
    descricao: 'Filtro de público: compara um campo do lead com um valor.',
    campos: [
      { nome: 'campo', label: 'Campo', tipo: 'select', padrao: 'estagio', opcoes: CAMPOS_LEAD_OPCOES },
      {
        nome: 'operador',
        label: 'Operador',
        tipo: 'select',
        padrao: 'igual',
        opcoes: OPERADORES.map((o) => ({ valor: o.valor, label: o.label })),
      },
      {
        nome: 'valor',
        label: 'Valor',
        tipo: 'texto',
        padrao: '',
        dica: 'Ignorado para "está vazio"/"não está vazio".',
      },
    ],
  },
  {
    tipo: 'lead_respondeu',
    label: 'Lead respondeu?',
    descricao: 'Passa conforme o lead ter respondido (ou não) a um contato da IA.',
    campos: [
      {
        nome: 'respondeu',
        label: 'Deve ter respondido',
        tipo: 'booleano',
        padrao: true,
        opcoes: [
          { valor: 'true', label: 'Sim, respondeu' },
          { valor: 'false', label: 'Não respondeu' },
        ],
      },
    ],
  },
]

// Estágios do pipeline (leads.estagio) para atualizar_status / mover_pipeline.
const ESTAGIO_OPCOES = [
  { valor: 'novos_leads', label: 'Novos leads' },
  { valor: 'primeiro_contato', label: '1º contato' },
  { valor: 'aguardando_resposta', label: 'Aguardando resposta' },
  { valor: 'follow_up', label: 'Follow-up' },
  { valor: 'interessado', label: 'Interessado' },
  { valor: 'respondeu', label: 'Respondeu' },
  { valor: 'reuniao_agendada', label: 'Reunião agendada' },
  { valor: 'ganho', label: 'Ganho' },
  { valor: 'perdido', label: 'Perdido' },
]

export const ACOES: BlocoDef[] = [
  {
    tipo: 'esperar',
    label: 'Esperar',
    descricao: 'Suspende a execução por um tempo (a espera é persistida no banco).',
    campos: [
      { nome: 'dias', label: 'Dias', tipo: 'numero', padrao: 2 },
      { nome: 'horas', label: 'Horas', tipo: 'numero', padrao: 0 },
    ],
  },
  {
    tipo: 'enviar_email',
    label: 'Enviar e-mail',
    descricao: 'Envia um template de e-mail ao lead (respeita o MODO_ENSAIO do motor).',
    campos: [
      { nome: 'template', label: 'Template', tipo: 'select', padrao: 'follow_up_1', opcoes: TEMPLATES_OPCOES },
    ],
  },
  {
    tipo: 'criar_tarefa',
    label: 'Criar tarefa',
    descricao: 'Cria uma tarefa vinculada ao lead.',
    campos: [{ nome: 'titulo', label: 'Título', tipo: 'texto', padrao: 'Tarefa do workflow' }],
  },
  {
    tipo: 'criar_tarefa_ligacao',
    label: 'Criar tarefa de ligação',
    descricao: 'Cria uma tarefa de ligação vinculada ao lead.',
    campos: [{ nome: 'titulo', label: 'Título', tipo: 'texto', padrao: 'Ligar para o lead' }],
  },
  {
    tipo: 'enviar_whatsapp',
    label: 'Enviar WhatsApp (stub)',
    descricao: 'Ainda sem integração: registra a intenção como pendente (não envia).',
    campos: [{ nome: 'texto', label: 'Mensagem', tipo: 'texto', padrao: '' }],
  },
  {
    tipo: 'atualizar_status',
    label: 'Atualizar status do lead',
    descricao: 'Muda o estágio/status do lead (leads.estagio).',
    campos: [
      {
        nome: 'estagio',
        label: 'Novo status',
        tipo: 'select',
        padrao: 'respondeu',
        opcoes: ESTAGIO_OPCOES,
        dica: 'Hoje age no mesmo campo que "Mover etapa do pipeline" (leads.estagio).',
      },
    ],
  },
  {
    tipo: 'mover_pipeline',
    label: 'Mover etapa do pipeline',
    descricao: 'Move o lead para outra etapa do pipeline (leads.estagio).',
    campos: [
      {
        nome: 'estagio',
        label: 'Etapa',
        tipo: 'select',
        padrao: 'follow_up',
        opcoes: ESTAGIO_OPCOES,
        dica: 'Hoje age no mesmo campo que "Atualizar status do lead" (leads.estagio).',
      },
    ],
  },
  {
    tipo: 'atribuir_responsavel',
    label: 'Atribuir responsável',
    descricao: 'Define o responsável do lead (perfis/usuário, por id).',
    campos: [
      { nome: 'responsavel_id', label: 'ID do responsável', tipo: 'texto', padrao: '', dica: 'UUID do usuário responsável.' },
    ],
  },
  {
    tipo: 'notificar',
    label: 'Notificar responsável interno',
    descricao: 'Avisa o responsável (e-mail e/ou WhatsApp — WhatsApp ainda em stub).',
    campos: [
      {
        nome: 'canais',
        label: 'Canais',
        tipo: 'select',
        padrao: 'email',
        opcoes: [
          { valor: 'email', label: 'E-mail' },
          { valor: 'whatsapp', label: 'WhatsApp (stub)' },
          { valor: 'ambos', label: 'E-mail + WhatsApp' },
        ],
      },
      { nome: 'mensagem', label: 'Mensagem', tipo: 'texto', padrao: '' },
    ],
  },
  {
    tipo: 'saltar_se',
    label: 'Ramificar (saltar se…)',
    descricao: 'Se a condição passar, salta para outro passo; senão continua.',
    campos: [], // editor dedicado (condição aninhada + destino), ver ResumoFluxo/editor
    configInicial: { condicao: { tipo: 'lead_respondeu', config: { respondeu: true } }, destino: 0 },
  },
  {
    tipo: 'encerrar',
    label: 'Encerrar fluxo',
    descricao: 'Conclui a execução aqui — sela um braço da ramificação.',
    campos: [],
  },
]

const PORTIPO: Record<string, BlocoDef> = Object.fromEntries(
  [...GATILHOS, ...CONDICOES, ...ACOES].map((b) => [b.tipo, b]),
)

export function acharBlocoDef(tipo: string): BlocoDef | undefined {
  return PORTIPO[tipo]
}

// Config padrão de um bloco (a partir dos `padrao` dos campos). Booleano vira
// boolean real; número vira number — é o que o motor lê em blocos.ts.
export function configPadrao(def: BlocoDef): Record<string, unknown> {
  if (def.configInicial) return JSON.parse(JSON.stringify(def.configInicial))
  const config: Record<string, unknown> = {}
  for (const c of def.campos) config[c.nome] = c.padrao
  return config
}

// Instancia um BlocoConfig novo com os padrões do tipo.
export function blocoPadrao(def: BlocoDef): BlocoConfig {
  return { tipo: def.tipo, config: configPadrao(def) }
}

// Definição inicial de um workflow recém-criado: gatilho padrão, sem condições,
// sem ações (o usuário adiciona; publicar exige ao menos uma ação).
export function definicaoVazia(): DefinicaoWorkflow {
  return { gatilho: blocoPadrao(GATILHOS[0]), condicoes: [], acoes: [] }
}

// Resumo legível de um bloco, para cards/listas. Ex.: "Enviar e-mail · Follow-up 1".
export function descreverBloco(bloco: BlocoConfig): string {
  const def = acharBlocoDef(bloco.tipo)
  if (!def) return bloco.tipo
  const partes: string[] = []
  for (const campo of def.campos) {
    const bruto = bloco.config?.[campo.nome]
    if (bruto === undefined || bruto === '' || bruto === null) continue
    let valor = String(bruto)
    if (campo.opcoes) valor = campo.opcoes.find((o) => o.valor === String(bruto))?.label ?? valor
    partes.push(valor)
  }
  return partes.length ? `${def.label} · ${partes.join(' · ')}` : def.label
}
