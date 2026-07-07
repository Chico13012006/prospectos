// Configuração do motor de automação (server-side).
// Duas camadas:
//   1) engineConfig — getters síncronos lendo process.env. Continua sendo a
//      fonte de MODO_ENSAIO e INTERNAL_SECRET (segurança, nunca vão pra tabela)
//      e o FALLBACK dos parâmetros de cadência. Scripts locais podem seguir
//      usando estes getters direto.
//   2) getEngineConfig() — parâmetros de cadência dinâmicos, lidos da tabela
//      `configuracoes_motor` (editável pela tela Configurações > Parâmetros),
//      com cache de ~30s e fallback pro .env se o banco falhar.
// Tem valores padrão SEGUROS: em modo de ensaio nada é enviado de verdade.
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { log } from './logger'

function num(v: string | undefined, padrao: number): number {
  const n = Number(v)
  return Number.isFinite(n) && v !== undefined && v !== '' ? n : padrao
}

// LEITURA PREGUIÇOSA (getters): cada valor é avaliado no MOMENTO DO ACESSO, não
// na importação do módulo. Assim, scripts que carregam o .env.local depois do
// import (ou plataformas que injetam env tarde) ainda enxergam o valor correto —
// evita o clássico "config caiu no default porque o dotenv carregou depois".
export const engineConfig = {
  // Quando true (default), os fluxos só LOGAM o que fariam — não enviam e-mail.
  // Vire para 'false' explicitamente quando quiser disparar de verdade.
  get modoEnsaio(): boolean {
    return (process.env.MODO_ENSAIO ?? 'true') !== 'false'
  },

  // Limite diário de envios (protege a reputação do domínio).
  get maxEnviosDia(): number {
    return num(process.env.MAX_ENVIOS_DIA, 40)
  },

  // Espera mínima entre follow-ups, em horas.
  get horasEntreFollowups(): number {
    return num(process.env.HORAS_ENTRE_FOLLOWUPS, 48)
  },

  // Máximo de follow-ups por lead antes de parar a cadência.
  get maxFollowups(): number {
    return num(process.env.MAX_FOLLOWUPS, 3)
  },

  // Espaçamento entre envios dentro de um mesmo lote (minutos). Protege a
  // reputação do domínio evitando rajada de e-mails idênticos de uma vez.
  // 0 (padrão) = sem espera, comportamento antigo. Usado por followUp() e
  // pelo script de disparo em lote do piloto.
  get intervaloEntreEnviosMin(): number {
    return num(process.env.INTERVALO_ENVIO_MIN, 0)
  },

  // E-mail de fallback do closer, caso o lead não tenha responsável definido.
  get closerEmailFallback(): string {
    return process.env.CLOSER_EMAIL ?? ''
  },

  // Segredo para proteger os endpoints internos do motor (reusa o já existente).
  get internalSecret(): string {
    return process.env.INTERNAL_SECRET ?? ''
  },
}

// ---------------------------------------------------------------------------
// Config dinâmica de cadência (tabela `configuracoes_motor`, migration 0005).
// ---------------------------------------------------------------------------

export interface ConfigMotor {
  maxEnviosDia: number
  horasEntreFollowups: number
  maxFollowups: number
  intervaloEntreEnviosMin: number
  diasSemanaAtivos: number[] // convenção JS Date.getDay(): 0=domingo..6=sábado
  closerEmailFallback: string
}

// Dias ativos quando não há linha no banco: seg-sex (comportamento histórico).
const DIAS_SEMANA_PADRAO = [1, 2, 3, 4, 5]

const CACHE_TTL_MS = 30_000
let cache: { valor: ConfigMotor; expiraEm: number } | null = null

function configDoEnv(): ConfigMotor {
  return {
    maxEnviosDia: engineConfig.maxEnviosDia,
    horasEntreFollowups: engineConfig.horasEntreFollowups,
    maxFollowups: engineConfig.maxFollowups,
    intervaloEntreEnviosMin: engineConfig.intervaloEntreEnviosMin,
    diasSemanaAtivos: DIAS_SEMANA_PADRAO,
    closerEmailFallback: engineConfig.closerEmailFallback,
  }
}

// '1,2,3' → [1,2,3]; descarta lixo e devolve null se nada sobrar (usa fallback).
function parseDiasSemana(csv: unknown): number[] | null {
  if (typeof csv !== 'string') return null
  const dias = csv
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
  return dias.length > 0 ? [...new Set(dias)].sort() : null
}

// Lê a config de cadência da tabela, com cache e fallback pro .env.
// O motor NUNCA trava por causa da tela de config: qualquer erro aqui
// (tabela vazia, Supabase fora, service key ausente) cai nos getters de env.
export async function getEngineConfig(): Promise<ConfigMotor> {
  if (cache && Date.now() < cache.expiraEm) return cache.valor

  let valor = configDoEnv()
  try {
    const db = createSupabaseAdminClient()
    const { data, error } = await db
      .from('configuracoes_motor')
      .select('*')
      .eq('id', 1)
      .maybeSingle()
    if (error) throw error
    if (data) {
      valor = {
        maxEnviosDia: Number.isFinite(data.max_envios_dia) ? data.max_envios_dia : valor.maxEnviosDia,
        horasEntreFollowups: Number.isFinite(data.horas_entre_followups) ? data.horas_entre_followups : valor.horasEntreFollowups,
        maxFollowups: Number.isFinite(data.max_followups) ? data.max_followups : valor.maxFollowups,
        intervaloEntreEnviosMin: Number.isFinite(data.intervalo_entre_envios_min) ? data.intervalo_entre_envios_min : valor.intervaloEntreEnviosMin,
        diasSemanaAtivos: parseDiasSemana(data.dias_semana_ativos) ?? valor.diasSemanaAtivos,
        closerEmailFallback: data.closer_email_fallback || valor.closerEmailFallback,
      }
    }
  } catch (e) {
    log.aviso('Config dinâmica indisponível — usando valores do .env como fallback.', {
      erro: e instanceof Error ? e.message : String(e),
    })
  }

  cache = { valor, expiraEm: Date.now() + CACHE_TTL_MS }
  return valor
}

// Chamado pela API depois de salvar, pra refletir a mudança na hora
// (sem esperar o TTL do cache expirar sozinho).
export function invalidarCacheConfig(): void {
  cache = null
}

// A trava de migração: os fluxos só agem em leads com este owner.
export const OWNER_ENGINE = 'engine' as const
