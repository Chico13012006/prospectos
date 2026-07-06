// Configuração do motor de automação, lida do ambiente (server-side).
// Tem valores padrão SEGUROS: em modo de ensaio nada é enviado de verdade.

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

// A trava de migração: os fluxos só agem em leads com este owner.
export const OWNER_ENGINE = 'engine' as const
