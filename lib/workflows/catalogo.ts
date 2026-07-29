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
