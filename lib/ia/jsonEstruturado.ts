// Camada única de geração de JSON estruturado — SERVER-ONLY. Esconde do resto
// da aplicação a diferença entre Anthropic (Messages API) e OpenAI (Responses
// API): quem chama passa prompt + JSON Schema e recebe o objeto já parseado.
// O provider vem de AI_PROVIDER (ver resolverProvedorIa); não há fallback
// automático entre providers.
//
// Todas as chamadas de LLM do projeto passam por aqui: Inteligência Comercial
// (./insightComercial), Copiloto pós-reunião (./copilotoReuniao), contatos
// alternativos (./contatosAlternativos) e classificador de respostas do handoff
// (lib/comercial/respostas/classificadorIa). Nenhuma funcionalidade chama os SDKs.
import 'server-only'
import {
  getAnthropicClient,
  getOpenAiClient,
  resolverProvedorIa,
  MODELO_COPILOTO,
  MODELO_INSIGHT,
  MODELO_OPENAI,
} from './cliente'

// Papel da chamada. Na Anthropic cada papel tem seu modelo: insight = barato
// (Inteligência Comercial, classificador, contatos alternativos) e copiloto =
// qualidade. Na OpenAI, por ora, todos usam OPENAI_MODEL.
export type PapelIa = 'insight' | 'copiloto'

export interface PedidoJsonEstruturado {
  papel: PapelIa
  system: string
  user: string
  // JSON Schema estrito: todo objeto com additionalProperties: false e todas as
  // propriedades em required (exigência do strict da OpenAI).
  schema: { [key: string]: unknown }
  // Nome do formato na OpenAI (a-z, A-Z, 0-9, _ ou -; até 64 caracteres).
  nomeSchema: string
  // Limite da resposta visível — o max_tokens que a Anthropic sempre recebeu.
  maxTokens: number
}

export type MotivoErroJsonEstruturado =
  | 'schema_nao_estrito'
  | 'falha'
  | 'recusa'
  | 'incompleta'
  | 'sem_texto'
  | 'json_invalido'

// Falha explícita da camada. A mensagem traz só o motivo — nunca a saída do
// modelo nem chaves —, porque as rotas logam o erro.
export class ErroJsonEstruturado extends Error {
  readonly motivo: MotivoErroJsonEstruturado

  constructor(motivo: MotivoErroJsonEstruturado, mensagem: string) {
    super(mensagem)
    this.name = 'ErroJsonEstruturado'
    this.motivo = motivo
  }
}

// Folga mínima para o raciocínio na OpenAI. Em modelos com raciocínio (o
// gpt-5.6-luna usa esforço "medium" por padrão) esses tokens contam no
// max_output_tokens: limitar ao tamanho da resposta visível cortaria o JSON.
// A folga cresce com a resposta (2× o limite visível, nunca menos que isto),
// para análises longas como a do copiloto. Só se paga o que for gerado, e o
// tamanho da resposta segue contido pelo prompt e pelo schema.
export const FOLGA_RACIOCINIO_OPENAI = 4000

function limiteSaidaOpenAi(maxTokens: number): number {
  return maxTokens + Math.max(FOLGA_RACIOCINIO_OPENAI, 2 * maxTokens)
}

export async function gerarJsonEstruturado(pedido: PedidoJsonEstruturado): Promise<unknown> {
  return resolverProvedorIa() === 'openai' ? gerarViaOpenAi(pedido) : gerarViaAnthropic(pedido)
}

// Anthropic: exatamente a chamada e a leitura que as funcionalidades faziam
// direto no SDK (primeiro bloco de texto; sem bloco, '{}'), para não mudar o
// comportamento existente.
async function gerarViaAnthropic(pedido: PedidoJsonEstruturado): Promise<unknown> {
  const client = getAnthropicClient()
  const resp = await client.messages.create({
    model: pedido.papel === 'copiloto' ? MODELO_COPILOTO : MODELO_INSIGHT,
    max_tokens: pedido.maxTokens,
    system: pedido.system,
    output_config: { format: { type: 'json_schema', schema: pedido.schema } },
    messages: [{ role: 'user', content: pedido.user }],
  })
  const bloco = resp.content.find((b) => b.type === 'text')
  const texto = bloco && bloco.type === 'text' ? bloco.text : '{}'
  return JSON.parse(texto)
}

// OpenAI (Responses API) com Structured Outputs estrito. Nada parcial passa:
// erro, recusa, resposta incompleta, ausência de texto ou JSON inválido viram
// ErroJsonEstruturado.
async function gerarViaOpenAi(pedido: PedidoJsonEstruturado): Promise<unknown> {
  exigirSchemaEstrito(pedido.schema, 'schema')
  const client = getOpenAiClient()
  const resp = await client.responses.create({
    model: MODELO_OPENAI,
    instructions: pedido.system,
    input: pedido.user,
    max_output_tokens: limiteSaidaOpenAi(pedido.maxTokens),
    text: {
      format: { type: 'json_schema', name: pedido.nomeSchema, schema: pedido.schema, strict: true },
    },
    // Chamada avulsa com dados de lead: não guarda a resposta na OpenAI.
    store: false,
  })

  if (resp.error) {
    throw new ErroJsonEstruturado('falha', `OpenAI retornou erro (${resp.error.code}).`)
  }
  // Só a mensagem final interessa: itens de raciocínio e mensagens de
  // "commentary" não fazem parte da resposta estruturada.
  const partes = resp.output.flatMap((item) =>
    item.type === 'message' && item.phase !== 'commentary' ? item.content : [],
  )
  if (partes.some((parte) => parte.type === 'refusal')) {
    throw new ErroJsonEstruturado('recusa', 'OpenAI recusou gerar a resposta estruturada.')
  }
  if (resp.status === 'incomplete') {
    const motivo = resp.incomplete_details?.reason ?? 'motivo não informado'
    throw new ErroJsonEstruturado('incompleta', `Resposta da OpenAI incompleta (${motivo}).`)
  }
  if (resp.status !== 'completed') {
    throw new ErroJsonEstruturado('falha', `Resposta da OpenAI não concluída (status: ${resp.status ?? 'ausente'}).`)
  }
  const texto = partes.map((parte) => (parte.type === 'output_text' ? parte.text : '')).join('')
  if (!texto.trim()) {
    throw new ErroJsonEstruturado('sem_texto', 'OpenAI não devolveu texto utilizável.')
  }
  let dados: unknown
  try {
    dados = JSON.parse(texto)
  } catch {
    throw new ErroJsonEstruturado('json_invalido', 'OpenAI devolveu JSON inválido.')
  }
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) {
    throw new ErroJsonEstruturado('json_invalido', 'OpenAI não devolveu um objeto JSON.')
  }
  return dados
}

// Confere o schema antes de chamar: a OpenAI rejeita schema frouxo com strict,
// e checar aqui dá erro claro sem gastar chamada. Cobre o subconjunto usado no
// projeto (object/properties/required/items).
function exigirSchemaEstrito(no: unknown, caminho: string): void {
  if (!no || typeof no !== 'object') return
  const s = no as {
    type?: unknown
    properties?: { [key: string]: unknown }
    required?: unknown
    additionalProperties?: unknown
    items?: unknown
  }
  if (caminho === 'schema' && s.type !== 'object') {
    throw new ErroJsonEstruturado('schema_nao_estrito', 'Schema estrito precisa ter um objeto na raiz.')
  }
  if (s.type === 'object') {
    if (s.additionalProperties !== false) {
      throw new ErroJsonEstruturado(
        'schema_nao_estrito',
        `Schema não estrito em ${caminho}: additionalProperties precisa ser false.`,
      )
    }
    const propriedades = Object.keys(s.properties ?? {})
    const obrigatorias: unknown[] = Array.isArray(s.required) ? s.required : []
    const foraDeRequired = propriedades.filter((p) => !obrigatorias.includes(p))
    if (foraDeRequired.length > 0) {
      throw new ErroJsonEstruturado(
        'schema_nao_estrito',
        `Schema não estrito em ${caminho}: fora de required — ${foraDeRequired.join(', ')}.`,
      )
    }
    for (const p of propriedades) exigirSchemaEstrito(s.properties?.[p], `${caminho}.${p}`)
  }
  if (s.items) exigirSchemaEstrito(s.items, `${caminho}[]`)
}
