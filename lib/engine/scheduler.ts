// Scheduler do follow-up automático (node-cron).
// Em dias úteis (seg–sex, 9h por padrão) roda a cadência diária na ordem:
//   1) detectarResposta — lê a caixa e pausa quem respondeu
//   2) fila.processar   — encaminha ao closer quem respondeu
//   3) followUp         — envia o próximo follow-up só para leads ativos
//                          owner='engine' cujo tempo de espera passou,
//                          respeitando MAX_FOLLOWUPS e o limite diário.
//
// Roda contra Supabase/Gmail reais. MODO_ENSAIO é respeitado pelo provedor
// (em ensaio o envio só é logado); as escritas no banco seguem o contrato do
// motor (acontecem, restritas a owner='engine').
//
// Sem efeitos colaterais na importação — os runners em scripts/ chamam estas
// funções depois de carregar o .env.local.
import { schedule, validate } from 'node-cron'
import { criarMotor, cadenciaDiaria, type Motor } from './index'
import { GmailProvider, lerCredenciaisGmail } from './email/gmailProvider'
import { engineConfig } from './config'
import { log } from './logger'

// Monta o motor "real": usa o GmailProvider quando há credenciais, para que o
// detectarResposta leia a CAIXA REAL mesmo em ensaio (a fábrica padrão cairia no
// provedor simulado, de caixa vazia). O envio continua gated por MODO_ENSAIO.
export function criarMotorReal(): Motor {
  const cred = lerCredenciaisGmail()
  if (!cred) {
    log.aviso('Sem GMAIL_USER/GMAIL_APP_PASSWORD — usando provedor padrão (caixa simulada).')
    return criarMotor()
  }
  return criarMotor({ email: new GmailProvider(cred) })
}

// Executa a cadência diária uma vez. forcar=true ignora a checagem de dia útil.
export async function rodarCadencia(opts?: { forcar?: boolean }) {
  const motor = criarMotorReal()
  return cadenciaDiaria(motor, opts)
}

// Agenda a cadência diária. Mantém o processo vivo (node-cron segura o event loop).
export function iniciarScheduler() {
  const expr = process.env.CRON_FOLLOWUP ?? '0 9 * * 1-5' // seg–sex às 9h
  const tz = process.env.CRON_TZ ?? 'America/Sao_Paulo'

  if (!validate(expr)) {
    throw new Error(`CRON_FOLLOWUP inválido: "${expr}"`)
  }

  log.info('Scheduler do follow-up iniciado', {
    cron: expr,
    timezone: tz,
    modoEnsaio: engineConfig.modoEnsaio,
    maxEnviosDia: engineConfig.maxEnviosDia,
    maxFollowups: engineConfig.maxFollowups,
  })

  // noOverlap evita execuções concorrentes se uma cadência demorar.
  schedule(
    expr,
    async () => {
      log.info('Disparo agendado — rodando cadência diária')
      try {
        await rodarCadencia()
      } catch (e) {
        log.erro('Falha na cadência agendada', {
          erro: e instanceof Error ? e.message : String(e),
        })
      }
    },
    { timezone: tz, noOverlap: true },
  )

  log.info('Aguardando próximos disparos (Ctrl+C para parar).')
}
