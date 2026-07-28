// Composição do motor: monta store + provedor de e-mail + fila (com handlers)
// e orquestra a cadência diária. Os endpoints em app/api/engine/* usam isto.
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { engineConfig, getEngineConfig, ORG_PADRAO_ID } from './config'
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

// Monta um motor PRESO a uma organização (multi-tenant, migration 0006). O
// Store real fica escopado nessa org; os overrides (testes/scripts) seguem
// podendo injetar store/email/fila próprios.
export function criarMotor(organizacaoId: string, overrides?: Partial<Motor>): Motor {
  const motor: Motor = {
    store: overrides?.store ?? new SupabaseStore(organizacaoId),
    email: overrides?.email ?? escolherEmailProvider(),
    fila: overrides?.fila ?? new Queue(),
  }
  registrarHandlers(motor)
  return motor
}

// Organizações ativas (para o cron varrer todas). service_role: bypassa RLS,
// então listamos direto. Se a tabela ainda não existir (ambiente sem a
// migration 0006), cai na org padrão pra não derrubar o cron.
export async function listarOrganizacoesAtivas(): Promise<string[]> {
  try {
    const db = createSupabaseAdminClient()
    const { data, error } = await db.from('organizacoes').select('id').eq('ativo', true)
    if (error) throw error
    const ids = (data ?? []).map((o) => o.id as string)
    return ids.length > 0 ? ids : [ORG_PADRAO_ID]
  } catch (e) {
    log.aviso('Não consegui listar organizações — usando a org padrão.', {
      erro: e instanceof Error ? e.message : String(e),
    })
    return [ORG_PADRAO_ID]
  }
}

// Descobre a organização de um lead (para endpoints que agem sobre 1 lead sem
// contexto de org, como /api/engine/executar-acao). service_role, filtro no
// código. Devolve null se o lead não existir.
export async function resolverOrgDoLead(leadId: string): Promise<string | null> {
  const db = createSupabaseAdminClient()
  const { data, error } = await db
    .from('leads')
    .select('organizacao_id')
    .eq('id', leadId)
    .maybeSingle()
  if (error) throw error
  return (data?.organizacao_id as string) ?? null
}

// Dia ativo? Convenção JS Date.getDay(): 0=domingo..6=sábado. A lista vem da
// config dinâmica (tela de Parâmetros); default seg-sex.
export function ehDiaUtil(diasAtivos: number[], d: Date = new Date()): boolean {
  return diasAtivos.includes(d.getDay())
}

// Cadência diária: detectar respostas → processar fila (closer) → follow-ups.
export async function cadenciaDiaria(motor: Motor, opts?: { forcar?: boolean }) {
  const cfg = await getEngineConfig(motor.store.organizacaoId)
  if (!opts?.forcar && !ehDiaUtil(cfg.diasSemanaAtivos)) {
    log.info('Hoje não é dia ativo da cadência — pulada.', { diasAtivos: cfg.diasSemanaAtivos })
    return { pulado: true as const }
  }
  log.info('=== Cadência diária iniciada ===', {
    organizacaoId: motor.store.organizacaoId,
    modoEnsaio: engineConfig.modoEnsaio,
  })
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

// Runner multi-tenant do cron: roda a cadência diária para CADA organização
// ativa, cada uma com seu motor escopado. Um erro numa org não derruba as
// outras. É o alvo natural dos endpoints/crons (que não têm auth.uid()).
export async function cadenciaTodasOrgs(opts?: { forcar?: boolean }) {
  const orgs = await listarOrganizacoesAtivas()
  const porOrg: Record<string, unknown> = {}
  for (const org of orgs) {
    try {
      const motor = criarMotor(org)
      porOrg[org] = await cadenciaDiaria(motor, opts)
    } catch (e) {
      log.erro('Cadência falhou para uma organização', {
        organizacaoId: org,
        erro: e instanceof Error ? e.message : String(e),
      })
      porOrg[org] = { erro: e instanceof Error ? e.message : String(e) }
    }
  }
  return { organizacoes: orgs.length, porOrg }
}

// Re-exports úteis aos endpoints/testes.
export { executarAcao, detectarResposta, followUp, direcionarCloser }
