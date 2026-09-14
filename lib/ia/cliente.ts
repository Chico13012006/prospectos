// Clientes de IA (Anthropic e OpenAI) — SERVER-ONLY. As chaves nunca vão pro
// browser: os SDKs só são usados pela camada ./jsonEstruturado; rotas e motor
// consultam daqui apenas a configuração (iaConfigurada).
import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'

let _anthropicClient: Anthropic | null = null
let _openAiClient: OpenAI | null = null

// Cliente preguiçoso: só instancia quando há chamada real (evita quebrar o build
// se a key não estiver setada no ambiente de build).
export function getAnthropicClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY não configurada — IA indisponível.')
  }
  if (!_anthropicClient) _anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return _anthropicClient
}

// Modelos Anthropic por papel (configuráveis por env). Insight por lead = barato
// (Haiku); copiloto pós-reunião = qualidade (Opus). IDs conferidos na referência da API.
export const MODELO_INSIGHT = process.env.IA_MODELO_INSIGHT || 'claude-haiku-4-5-20251001'
export const MODELO_COPILOTO = process.env.IA_MODELO_COPILOTO || 'claude-opus-4-8'

// Provider da camada de JSON estruturado (./jsonEstruturado). Ausente ou vazio →
// anthropic, para um deploy sem AI_PROVIDER manter o comportamento atual. Valor
// desconhecido falha em vez de cair num provider em silêncio.
export type ProvedorIa = 'anthropic' | 'openai'

export function resolverProvedorIa(): ProvedorIa {
  const valor = (process.env.AI_PROVIDER ?? '').trim().toLowerCase()
  if (valor === '' || valor === 'anthropic') return 'anthropic'
  if (valor === 'openai') return 'openai'
  throw new Error(`AI_PROVIDER inválido: "${valor}" — use "anthropic" ou "openai".`)
}

// IA configurada para o provider ativo. Sem fallback: com openai, a chave da
// Anthropic não conta (e vice-versa). AI_PROVIDER inválido lança o mesmo erro
// explícito de resolverProvedorIa.
export function iaConfigurada(): boolean {
  return resolverProvedorIa() === 'openai' ? !!process.env.OPENAI_API_KEY : !!process.env.ANTHROPIC_API_KEY
}

// Cliente OpenAI preguiçoso, no mesmo molde do Anthropic.
export function getOpenAiClient(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY não configurada — IA indisponível.')
  }
  if (!_openAiClient) _openAiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  return _openAiClient
}

// Modelo OpenAI: um só para todos os papéis, por enquanto.
export const MODELO_OPENAI = process.env.OPENAI_MODEL || 'gpt-5.6-luna'
