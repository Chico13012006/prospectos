// Copiloto de IA pós-reunião (sprint item 8). SEM Google Meet, SEM áudio: o
// vendedor cola a transcrição (já gerada pelo Meet) e a IA (Opus — qualidade)
// devolve uma leitura estruturada da conversa. SERVER-ONLY.
//
// Nada aqui envia e-mail nem muda o lead sozinho: a saída é SUGESTÃO. Quem aplica
// (estágio, e-mail, proposta) é o vendedor, na tela. O vocabulário de equipamentos
// casa com o simulador (item 6) — mesmos ProdutoId — para pré-preencher a proposta.
import { getIaClient, MODELO_COPILOTO } from './cliente'
import { PRODUTOS, type ProdutoId } from '@/lib/simulador'

// Estágios que o copiloto pode SUGERIR (subconjunto do funil manual do pipeline).
export const ESTAGIOS_SUGERIVEIS = [
  'interessado', 'reuniao_agendada', 'com_closer', 'ganho', 'perdido', 'follow_up',
] as const
export type EstagioSugerido = (typeof ESTAGIOS_SUGERIVEIS)[number]

export interface EquipamentoMencionado {
  produto: ProdutoId
  quantidade: number
}

export interface AnaliseReuniao {
  resumo: string
  dores: string[]
  necessidades: string[]
  objecoes: string[]
  equipamentos: EquipamentoMencionado[]
  proximosPassos: string[]
  tarefas: string[]
  estagioSugerido: EstagioSugerido | null
  proximoFollowup: string // texto curto ("em 3 dias úteis", "semana que vem")
  emailAssunto: string
  emailCorpo: string
}

const IDS_PRODUTO = PRODUTOS.map((p) => p.id)

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    resumo: { type: 'string' },
    dores: { type: 'array', items: { type: 'string' } },
    necessidades: { type: 'array', items: { type: 'string' } },
    objecoes: { type: 'array', items: { type: 'string' } },
    equipamentos: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          produto: { type: 'string', enum: IDS_PRODUTO },
          quantidade: { type: 'integer' },
        },
        required: ['produto', 'quantidade'],
      },
    },
    proximosPassos: { type: 'array', items: { type: 'string' } },
    tarefas: { type: 'array', items: { type: 'string' } },
    estagioSugerido: { type: 'string', enum: [...ESTAGIOS_SUGERIVEIS, ''] },
    proximoFollowup: { type: 'string' },
    emailAssunto: { type: 'string' },
    emailCorpo: { type: 'string' },
  },
  required: [
    'resumo', 'dores', 'necessidades', 'objecoes', 'equipamentos',
    'proximosPassos', 'tarefas', 'estagioSugerido', 'proximoFollowup',
    'emailAssunto', 'emailCorpo',
  ],
} as const

const SISTEMA =
  'Você é um copiloto comercial da iNOVACODE, que vende automação de estoque com ' +
  'RFID (coletores, impressoras, totens, PDV e mesa de conferência RFID). Recebe a ' +
  'TRANSCRIÇÃO de uma reunião de vendas e produz uma análise estruturada e ' +
  'acionável em português do Brasil, fiel ao que foi dito — NÃO invente fatos, ' +
  'números ou compromissos que não estão na transcrição. Para "equipamentos", só ' +
  'inclua itens realmente mencionados, usando os identificadores: ' +
  IDS_PRODUTO.join(', ') + ' (coletor, impressora, totem, pdv, mesa_rfid). Se a ' +
  'quantidade não foi dita, use 1. O e-mail de agradecimento deve ser curto, ' +
  'profissional e referenciar pontos concretos da conversa. Em "estagioSugerido", ' +
  'escolha o estágio de funil mais coerente com o desfecho (ou "" se não der para ' +
  'inferir). Listas vazias são aceitáveis quando não houver conteúdo.'

// Analisa a transcrição. Lança se a IA estiver indisponível/retornar inválido —
// a rota traduz para um erro amigável (diferente da extração best-effort do item 7:
// aqui a análise É o produto, então falhar em silêncio esconderia o problema).
export async function analisarReuniao(
  transcricao: string,
  contexto?: { empresa?: string | null; contato?: string | null },
): Promise<AnaliseReuniao> {
  const client = getIaClient()
  const ctx = contexto?.empresa || contexto?.contato
    ? `Contexto do lead: empresa "${contexto?.empresa ?? '—'}", contato "${contexto?.contato ?? '—'}".\n\n`
    : ''
  const resp = await client.messages.create({
    model: MODELO_COPILOTO,
    max_tokens: 2000,
    system: SISTEMA,
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    messages: [
      { role: 'user', content: `${ctx}Transcrição da reunião:\n\n${transcricao.slice(0, 24000)}` },
    ],
  })
  const bloco = resp.content.find((b) => b.type === 'text')
  const raw = bloco && bloco.type === 'text' ? bloco.text : '{}'
  return normalizarAnalise(JSON.parse(raw))
}

// Normaliza + valida a saída bruta da IA. PURA (testável sem rede): descarta
// equipamentos fora do vocabulário do simulador, força quantidade >= 1, e só
// aceita estágio dentro do enum sugerível (senão null).
export function normalizarAnalise(bruto: unknown): AnaliseReuniao {
  const d = (bruto ?? {}) as Record<string, unknown>
  const listaStr = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []

  const idsValidos = new Set<string>(IDS_PRODUTO)
  const equipamentos: EquipamentoMencionado[] = Array.isArray(d.equipamentos)
    ? (d.equipamentos as Array<{ produto?: unknown; quantidade?: unknown }>)
        .filter((e) => idsValidos.has(String(e.produto)))
        .map((e) => ({
          produto: String(e.produto) as ProdutoId,
          quantidade: Math.max(1, Math.round(Number(e.quantidade) || 1)),
        }))
    : []

  const estagio = String(d.estagioSugerido ?? '')
  const estagioSugerido = (ESTAGIOS_SUGERIVEIS as readonly string[]).includes(estagio)
    ? (estagio as EstagioSugerido)
    : null

  return {
    resumo: String(d.resumo ?? '').trim(),
    dores: listaStr(d.dores),
    necessidades: listaStr(d.necessidades),
    objecoes: listaStr(d.objecoes),
    equipamentos,
    proximosPassos: listaStr(d.proximosPassos),
    tarefas: listaStr(d.tarefas),
    estagioSugerido,
    proximoFollowup: String(d.proximoFollowup ?? '').trim(),
    emailAssunto: String(d.emailAssunto ?? '').trim(),
    emailCorpo: String(d.emailCorpo ?? '').trim(),
  }
}
