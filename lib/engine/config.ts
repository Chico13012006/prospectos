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

  // Cadência de follow-up: dias corridos A PARTIR DO 1º CONTATO em que cada
  // follow-up deve sair (item 3). Substitui o intervalo fixo único + MAX_FOLLOWUPS.
  // Configurável por env DIAS_FOLLOWUPS (csv crescente); default 3/7/14/30/60/90/120/180.
  get diasFollowups(): number[] {
    return parseDiasFollowups(process.env.DIAS_FOLLOWUPS) ?? DIAS_FOLLOWUPS_PADRAO
  },

  // Máximo de follow-ups por lead = tamanho da sequência de dias (source of
  // truth). O antigo MAX_FOLLOWUPS fixo foi substituído pela cadência (item 3).
  get maxFollowups(): number {
    return this.diasFollowups.length
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
  horasEntreFollowups: number // legado — só fallback de elegibilidade sem proxima_acao_data
  maxFollowups: number // = diasFollowups.length
  diasFollowups: number[] // dias corridos a partir do 1º contato p/ cada follow-up
  intervaloEntreEnviosMin: number
  diasSemanaAtivos: number[] // convenção JS Date.getDay(): 0=domingo..6=sábado
  closerEmailFallback: string
}

// Dias ativos quando não há linha no banco: seg-sex (comportamento histórico).
const DIAS_SEMANA_PADRAO = [1, 2, 3, 4, 5]

// Nova cadência (item 3): 8 follow-ups em dias corridos a partir do 1º contato.
// Mesmo template/tom em todas as etapas — só muda o espaçamento.
export const DIAS_FOLLOWUPS_PADRAO = [3, 7, 14, 30, 60, 90, 120, 180]

// 'csv' → array de dias CRESCENTE e positivo (senão null → usa o padrão).
function parseDiasFollowups(csv: string | undefined): number[] | null {
  if (typeof csv !== 'string') return null
  const dias = csv.split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0)
  const crescente = dias.length > 0 && dias.every((d, i) => i === 0 || d > dias[i - 1])
  return crescente ? dias : null
}

const MS_DIA = 86_400_000

// Data-alvo do PRÓXIMO follow-up depois de já ter enviado `jaEnviados`
// (0 = acabou de fazer o 1º contato → agenda o 1º follow-up). Ancorada na
// data-alvo ATUAL (drift-free: equivale a offset absoluto a partir do 1º
// contato, mesmo se o disparo atrasar um dia); sem ela, ancora em `agora`.
// Devolve null quando a sequência acabou (não há próximo follow-up).
export function proximaDataFollowup(
  dias: number[],
  jaEnviados: number,
  alvoAtual: Date | null,
  agora: Date,
): string | null {
  const idx = jaEnviados // índice 0-based do próximo follow-up na sequência
  if (idx < 0 || idx >= dias.length) return null
  const gap = idx === 0 ? dias[0] : dias[idx] - dias[idx - 1]
  const base = alvoAtual ?? agora
  return new Date(base.getTime() + gap * MS_DIA).toISOString()
}

const CACHE_TTL_MS = 30_000
// Cache por organização: a config de cadência agora é 1 linha por org
// (migration 0006 — configuracoes_motor deixou de ser singleton id=1).
const cachePorOrg = new Map<string, { valor: ConfigMotor; expiraEm: number }>()

function configDoEnv(): ConfigMotor {
  return {
    maxEnviosDia: engineConfig.maxEnviosDia,
    horasEntreFollowups: engineConfig.horasEntreFollowups,
    diasFollowups: engineConfig.diasFollowups,
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

// Lê a config de cadência da tabela (por organização), com cache e fallback
// pro .env. O motor NUNCA trava por causa da tela de config: qualquer erro aqui
// (linha ausente, Supabase fora, service key ausente) cai nos getters de env.
//
// `organizacaoId` omitido = contexto sem org (scripts/testes com MemoryStore):
// devolve só a config do .env, sem tocar no banco — mesmo comportamento seguro
// de antes. Com org, lê a linha `configuracoes_motor` daquela organização.
// USA service_role (bypassa RLS), por isso o filtro por organizacao_id abaixo
// é obrigatório — é ele que garante o isolamento neste caminho.
export async function getEngineConfig(organizacaoId?: string): Promise<ConfigMotor> {
  const chave = organizacaoId ?? '__env__'
  const cache = cachePorOrg.get(chave)
  if (cache && Date.now() < cache.expiraEm) return cache.valor

  let valor = configDoEnv()
  if (organizacaoId) {
    try {
      const db = createSupabaseAdminClient()
      const { data, error } = await db
        .from('configuracoes_motor')
        .select('*')
        .eq('organizacao_id', organizacaoId)
        .maybeSingle()
      if (error) throw error
      if (data) {
        valor = {
          maxEnviosDia: Number.isFinite(data.max_envios_dia) ? data.max_envios_dia : valor.maxEnviosDia,
          horasEntreFollowups: Number.isFinite(data.horas_entre_followups) ? data.horas_entre_followups : valor.horasEntreFollowups,
          diasFollowups: valor.diasFollowups,
          // A contagem vem da sequência de dias (item 3), não mais da coluna
          // max_followups (mantida só p/ compat/exibição na tela de Parâmetros).
          maxFollowups: valor.diasFollowups.length,
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
  }

  cachePorOrg.set(chave, { valor, expiraEm: Date.now() + CACHE_TTL_MS })
  return valor
}

// Chamado pela API depois de salvar, pra refletir a mudança na hora (sem
// esperar o TTL). Sem argumento, limpa o cache de todas as organizações.
export function invalidarCacheConfig(organizacaoId?: string): void {
  if (organizacaoId) cachePorOrg.delete(organizacaoId)
  else cachePorOrg.clear()
}

// A trava de migração: os fluxos só agem em leads com este owner.
export const OWNER_ENGINE = 'engine' as const

// Organização padrão (backfill da migration 0006). UUID FIXO — precisa bater
// com o INSERT em db/migrations/0006_organizacoes_rls.sql. É a org da instância
// single-tenant atual; scripts e o runner de cron usam como ponto de partida.
export const ORG_PADRAO_ID = '00000000-0000-0000-0000-000000000001' as const
