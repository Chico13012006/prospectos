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

// 'usuario' = dropdown de usuários reais da org (carregados via getUsuarios no
// editor; a UI resolve as opções em runtime, não são estáticas no catálogo).
export type CampoTipo = 'texto' | 'numero' | 'select' | 'booleano' | 'usuario'

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

// Só as colunas de DATA (para gatilhos temporais).
const CAMPOS_DATA_OPCOES = [
  { valor: 'ultimo_contato', label: 'Último contato' },
  { valor: 'created_at', label: 'Data de entrada' },
  { valor: 'proxima_acao_data', label: 'Próxima ação' },
  { valor: 'data_validade', label: 'Validade do laudo' },
]

// Operadores como opções de select (reaproveita a fonte única de operadores.ts).
const OPERADORES_OPCOES = OPERADORES.map((o) => ({ valor: o.valor, label: o.label }))

export const GATILHOS: BlocoDef[] = [
  {
    tipo: 'campo_data_vence',
    label: 'Campo de data vence em X dias',
    descricao: 'Inscreve o lead quando um campo de data dele vence em até N dias. Use "Validade do laudo" para renovação.',
    campos: [
      { nome: 'campo', label: 'Campo de data', tipo: 'select', padrao: 'proxima_acao_data', opcoes: CAMPOS_DATA_OPCOES },
      { nome: 'dias', label: 'Dias de antecedência', tipo: 'numero', padrao: 0 },
    ],
  },
  {
    tipo: 'validade_laudo_venceu',
    label: 'Validade do laudo venceu',
    descricao: 'Dispara quando leads.data_validade é passada (laudo vencido). Atalho para campo_data_vence com dias=0 no campo data_validade.',
    campos: [
      { nome: 'dias_apos', label: 'Dias após vencimento', tipo: 'numero', padrao: 0, dica: '0 = no dia do vencimento; 7 = uma semana após.' },
    ],
  },
  {
    tipo: 'lead_respondeu_gatilho',
    label: 'Lead respondeu',
    descricao: 'Inscreve leads que responderam recentemente (último contato inbound). Complementa o fluxo de cadência de resposta.',
    campos: [
      { nome: 'dentro_de_dias', label: 'Nos últimos N dias', tipo: 'numero', padrao: 3, dica: '0 = qualquer momento.' },
    ],
  },
  {
    tipo: 'nao_respondeu_em_dias',
    label: 'Lead não respondeu em X dias',
    descricao: 'Leads que não tiveram resposta inbound há N dias. Ideal para reengajamento.',
    campos: [
      { nome: 'dias', label: 'Dias sem resposta', tipo: 'numero', padrao: 5 },
    ],
  },
  {
    tipo: 'status_mudou',
    label: 'Status ou etapa mudou',
    descricao: 'Dispara quando o campo leads.estagio muda para o valor configurado.',
    campos: [
      {
        nome: 'estagio',
        label: 'Novo status/etapa',
        tipo: 'select',
        padrao: 'interessado',
        opcoes: [
          { valor: 'novos_leads', label: 'Novos leads' },
          { valor: 'primeiro_contato', label: '1º contato' },
          { valor: 'aguardando_resposta', label: 'Aguardando resposta' },
          { valor: 'follow_up', label: 'Follow-up' },
          { valor: 'interessado', label: 'Respondeu (interessado)' },
          { valor: 'reuniao_agendada', label: 'Reunião agendada' },
          { valor: 'ganho', label: 'Ganho' },
          { valor: 'perdido', label: 'Perdido' },
          { valor: 'sem_resposta', label: 'Sem resposta' },
        ],
      },
    ],
  },
  {
    tipo: 'campo_igual',
    label: 'Campo do lead (status/etapa)',
    descricao: 'Dispara quando um campo do lead bate com um valor configurado.',
    campos: [
      {
        nome: 'campo',
        label: 'Campo',
        tipo: 'select',
        padrao: 'estagio',
        opcoes: CAMPOS_LEAD_OPCOES,
        dica: 'Serve tanto para "mudou de status" quanto "entrou em etapa" (mesma coluna).',
      },
      { nome: 'operador', label: 'Operador', tipo: 'select', padrao: 'igual', opcoes: OPERADORES_OPCOES },
      { nome: 'valor', label: 'Valor', tipo: 'texto', padrao: '' },
    ],
  },
  {
    tipo: 'sem_resposta_ha_dias',
    label: 'Sem resposta há N dias (avançado)',
    descricao: 'Leads que nunca responderam e cujo campo de data é mais antigo que N dias.',
    campos: [
      { nome: 'campo', label: 'Campo de data', tipo: 'select', padrao: 'ultimo_contato', opcoes: CAMPOS_DATA_OPCOES },
      { nome: 'dias', label: 'Dias sem resposta', tipo: 'numero', padrao: 5 },
    ],
  },
  {
    tipo: 'manual',
    label: 'Manual (inscrição sob demanda)',
    descricao: 'Não auto-inscreve pelo cron — use "Inscrever lead" na tela do workflow.',
    campos: [],
  },
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
  {
    tipo: 'responsavel_lead_igual',
    label: 'Responsável do lead',
    descricao: 'Passa somente se o responsável do lead for o usuário selecionado. Use para direcionar ações apenas a leads de uma pessoa específica.',
    campos: [
      { nome: 'responsavel_id', label: 'Responsável', tipo: 'usuario', padrao: '', dica: 'Só leads cujo responsável for este usuário passarão pela condição.' },
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
    descricao: 'Cria uma tarefa vinculada ao lead, com responsável.',
    campos: [
      { nome: 'titulo', label: 'Título', tipo: 'texto', padrao: 'Tarefa do workflow' },
      { nome: 'responsavel_id', label: 'Responsável', tipo: 'usuario', padrao: '', dica: 'Vazio = responsável do próprio lead.' },
    ],
  },
  {
    tipo: 'criar_tarefa_ligacao',
    label: 'Criar tarefa de ligação',
    descricao: 'Cria uma tarefa de ligação vinculada ao lead, com responsável.',
    campos: [
      { nome: 'titulo', label: 'Título', tipo: 'texto', padrao: 'Ligar para o lead' },
      { nome: 'responsavel_id', label: 'Responsável', tipo: 'usuario', padrao: '', dica: 'Vazio = responsável do próprio lead.' },
    ],
  },
  {
    tipo: 'criar_oportunidade',
    label: 'Criar oportunidade',
    descricao: 'Abre um negócio (deal) a partir do lead — passa a aparecer em Oportunidades.',
    campos: [
      { nome: 'titulo', label: 'Título', tipo: 'texto', padrao: '', dica: 'Vazio = "Oportunidade — {empresa do lead}".' },
      { nome: 'valor', label: 'Valor (R$)', tipo: 'numero', padrao: 0, dica: 'Opcional; alimenta o ROI.' },
    ],
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
    descricao: 'Define o responsável do lead.',
    campos: [
      { nome: 'responsavel_id', label: 'Responsável', tipo: 'usuario', padrao: '' },
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
    // destino = id do passo alvo (string). '' = ainda não escolhido (a UI valida).
    configInicial: { condicao: { tipo: 'lead_respondeu', config: { respondeu: true } }, destino: '' },
  },
  {
    tipo: 'encerrar',
    label: 'Encerrar fluxo',
    descricao: 'Conclui a execução aqui — sela um braço da ramificação.',
    campos: [],
  },
  {
    tipo: 'parar_cadencia',
    label: 'Parar cadência',
    descricao: 'Interrompe imediatamente a cadência do lead e cancela as próximas ações pendentes.',
    campos: [
      { nome: 'motivo', label: 'Motivo (opcional)', tipo: 'texto', padrao: '', dica: 'Gravado no evento de auditoria da execução.' },
    ],
  },
  {
    tipo: 'adicionar_campanha',
    label: 'Adicionar a campanha',
    descricao: 'Inscreve o lead em outra campanha ativa — útil para pipelines encadeados (ex.: laudo venceu → inscreve em Renovação).',
    campos: [
      { nome: 'campanha_id', label: 'ID da campanha', tipo: 'texto', padrao: '', dica: 'Cole o ID da campanha (UUID) da tela de Campanhas.' },
    ],
  },
  {
    tipo: 'programar_reativacao',
    label: 'Programar reativação',
    descricao: 'Agenda um follow-up de reativação após N dias (grava proxima_acao_data + estagio=sem_resposta).',
    campos: [
      { nome: 'dias', label: 'Dias para reativar', tipo: 'numero', padrao: 30 },
    ],
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

// ID estável de passo (Web Crypto — existe no browser e no Node 20+).
function novoId(): string {
  return globalThis.crypto.randomUUID()
}

// Instancia um BlocoConfig novo com os padrões do tipo, já com um id estável.
export function blocoPadrao(def: BlocoDef): BlocoConfig {
  return { id: novoId(), tipo: def.tipo, config: configPadrao(def) }
}

// Garante que TODA ação tem um id estável (backfill de defs antigas ao carregar
// no editor). Alvos de saltar_se referenciam esses ids.
export function garantirIdsAcoes(def: DefinicaoWorkflow): DefinicaoWorkflow {
  return { ...def, acoes: (def.acoes ?? []).map((a) => (a.id ? a : { ...a, id: novoId() })) }
}

// Definição inicial de um workflow recém-criado: gatilho padrão, sem condições,
// sem ações (o usuário adiciona; publicar exige ao menos uma ação).
export function definicaoVazia(): DefinicaoWorkflow {
  return { gatilho: blocoPadrao(GATILHOS[0]), condicoes: [], acoes: [] }
}

// Rótulo mínimo de usuário para resolver campos tipo 'usuario' (id → nome) no
// resumo. A lista real de usuários só existe em runtime (getUsuarios no editor),
// por isso entra como parâmetro opcional — não dá para embutir no catálogo.
export interface UsuarioRotulo {
  id: string
  nome: string
}

// Resumo legível de um bloco, para cards/listas. Ex.: "Enviar e-mail · Follow-up 1".
// Passe `usuarios` para resolver campos tipo 'usuario' (ex.: responsavel_id) do
// UUID cru para o nome; sem a lista, mantém o valor cru (fallback).
export function descreverBloco(bloco: BlocoConfig, usuarios?: UsuarioRotulo[]): string {
  const def = acharBlocoDef(bloco.tipo)
  if (!def) return bloco.tipo
  const partes: string[] = []
  for (const campo of def.campos) {
    const bruto = bloco.config?.[campo.nome]
    if (bruto === undefined || bruto === '' || bruto === null) continue
    let valor = String(bruto)
    if (campo.opcoes) valor = campo.opcoes.find((o) => o.valor === String(bruto))?.label ?? valor
    else if (campo.tipo === 'usuario' && usuarios)
      valor = usuarios.find((u) => u.id === String(bruto))?.nome ?? valor
    partes.push(valor)
  }
  return partes.length ? `${def.label} · ${partes.join(' · ')}` : def.label
}
