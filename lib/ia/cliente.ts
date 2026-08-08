// Cliente Claude (Anthropic) — SERVER-ONLY. A ANTHROPIC_API_KEY nunca vai pro
// browser: este módulo só é importado por rotas de API / código server-side.
// Itens 4 (Inteligência Comercial), 7 e 8 (copiloto) do sprint dependem disto.
import 'server-only'
import Anthropic from '@anthropic-ai/sdk'

let _client: Anthropic | null = null

// Cliente preguiçoso: só instancia quando há chamada real (evita quebrar o build
// se a key não estiver setada no ambiente de build).
export function getIaClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY não configurada — IA indisponível.')
  }
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return _client
}

export function iaConfigurada(): boolean {
  return !!process.env.ANTHROPIC_API_KEY
}

// Modelos por papel (configuráveis por env). Insight por lead = barato (Haiku);
// copiloto pós-reunião = qualidade (Opus). IDs conferidos na referência da API.
export const MODELO_INSIGHT = process.env.IA_MODELO_INSIGHT || 'claude-haiku-4-5-20251001'
export const MODELO_COPILOTO = process.env.IA_MODELO_COPILOTO || 'claude-opus-4-8'
