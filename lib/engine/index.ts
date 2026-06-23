// Composição do motor: monta store + provedor de e-mail + fila (com handlers)
// e orquestra a cadência diária. Os endpoints em app/api/engine/* usam isto.
import { engineConfig } from './config'
import { log } from './logger'
import { Queue } from './queue'
import { SupabaseStore } from './store/supabaseStore'
import { SimulatedProvider } from './email/simulatedProvider'
import { GmailProvider, lerCredenciaisGmail } from './email/gmailProvider'
import type { Store } from './store/store'
import type { EmailProvider } from './email/provider'
import { direcionarCloser } from './flows/direcionarCloser'
import { detectarResposta } from './flows/detectarResposta'
import { followUp } from './flows/followUp'
import { executarAcao } from './flows/executarAcao'

export interface Motor {
  store: Store
  email: EmailProvider
  fila: Queue
}

// Escolhe o provedor: Gmail só quando houver credenciais E não estivermos em
// ensaio; caso contrário, simulado (que apenas loga o que faria).
export function escolherEmailProvider(): EmailProvider {
  const cred = lerCredenciaisGmail()
  if (cred && !engineConfig.modoEnsaio) return new GmailProvider(cred)
  if (engineConfig.modoEnsaio) log.info('Motor em MODO_ENSAIO: e-mails serão apenas simulados.')
  return new SimulatedProvider()
}

// Registra os handlers da fila (hoje: direcionar ao closer).
export function registrarHandlers(motor: Motor) {
  motor.fila.registrar('direcionar_closer', (p) =>
    direcionarCloser(motor.store, motor.email, p as { leadId: string; textoResposta: string }),
  )
}

export function criarMotor(overrides?: Partial<Motor>): Motor {
  const motor: Motor = {
    store: overrides?.store ?? new SupabaseStore(),
    email: overrides?.email ?? escolherEmailProvider(),
    fila: overrides?.fila ?? new Queue(),
  }
  registrarHandlers(motor)
  return motor
}

// Dias úteis: segunda(1) a sexta(5).
export function ehDiaUtil(d: Date = new Date()): boolean {
  const dia = d.getDay()
  return dia >= 1 && dia <= 5
}

// Cadência diária: detectar respostas → processar fila (closer) → follow-ups.
export async function cadenciaDiaria(motor: Motor, opts?: { forcar?: boolean }) {
  if (!opts?.forcar && !ehDiaUtil()) {
    log.info('Hoje não é dia útil — cadência diária pulada.')
    return { pulado: true as const }
  }
  log.info('=== Cadência diária iniciada ===', { modoEnsaio: engineConfig.modoEnsaio })
  const resp = await detectarResposta(motor.store, motor.email, motor.fila)
  await motor.fila.processar()
  const fu = await followUp(motor.store, motor.email)
  const escaninho = motor.fila.escaninhoErro()
  log.info('=== Cadência diária concluída ===', {
    respostas: resp.respostas,
    ignoradas: resp.ignoradas,
    followupsEnviados: fu.enviados,
    jobsComErro: escaninho.length,
  })
  return { pulado: false as const, ...resp, ...fu, jobsComErro: escaninho.length }
}

// Re-exports úteis aos endpoints/testes.
export { executarAcao, detectarResposta, followUp, direcionarCloser }
