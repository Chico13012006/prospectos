// Configuração do motor de automação, lida do ambiente (server-side).
// Tem valores padrão SEGUROS: em modo de ensaio nada é enviado de verdade.

function num(v: string | undefined, padrao: number): number {
  const n = Number(v)
  return Number.isFinite(n) && v !== undefined && v !== '' ? n : padrao
}

export const engineConfig = {
  // Quando true (default), os fluxos só LOGAM o que fariam — não enviam e-mail.
  // Vire para 'false' explicitamente quando quiser disparar de verdade.
  modoEnsaio: (process.env.MODO_ENSAIO ?? 'true') !== 'false',

  // Limite diário de envios (protege a reputação do domínio).
  maxEnviosDia: num(process.env.MAX_ENVIOS_DIA, 40),

  // Espera mínima entre follow-ups, em horas.
  horasEntreFollowups: num(process.env.HORAS_ENTRE_FOLLOWUPS, 48),

  // Máximo de follow-ups por lead antes de parar a cadência.
  maxFollowups: num(process.env.MAX_FOLLOWUPS, 3),

  // E-mail de fallback do closer, caso o lead não tenha responsável definido.
  closerEmailFallback: process.env.CLOSER_EMAIL ?? '',

  // Segredo para proteger os endpoints internos do motor (reusa o já existente).
  internalSecret: process.env.INTERNAL_SECRET ?? '',
} as const

// A trava de migração: os fluxos só agem em leads com este owner.
export const OWNER_ENGINE = 'engine' as const
