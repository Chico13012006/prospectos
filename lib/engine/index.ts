// Composição do motor: monta store + provedor de e-mail + fila (com handlers)
// e orquestra a cadência diária. Os endpoints em app/api/engine/* usam isto.
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { engineConfig, getEngineConfig, ORG_PADRAO_ID } from './config'
import { log } from './logger'
import { Queue } from './queue'
import { SupabaseStore } from './store/supabaseStore'
import { SimulatedProvider } from './email/simulatedProvider'
import { GmailProvider, lerCredenciaisGmail, type PapelEmail } from './email/gmailProvider'
import type { Store } from './store/store'
import type { EmailProvider } from './email/provider'
import { direcionarCloser } from './flows/direcionarCloser'
import { detectarResposta } from './flows/detectarResposta'
import { followUp } from './flows/followUp'
import { executarAcao } from './flows/executarAcao'
import { marcarExecucaoFollowup, verificarSaudeFollowup } from './saude'
import { enviarRelatorioSemanal, coletarKpisSemana, montarEmailRelatorio } from './relatorioSemanal'
import { extrairContatosAlternativos } from '@/lib/ia/contatosAlternativos'

export interface Motor {
  store: Store
  // Conta de FOLLOW-UP (cadência). É o provedor "padrão" do motor.
  email: EmailProvider
  // Conta de PROSPECÇÃO (1º contato/abordagem + aviso ao closer). Item 2.7.
  // Cai na mesma conta de `email` enquanto a 2ª credencial não estiver setada.
  emailProspeccao: EmailProvider
  fila: Queue
}

// Escolhe o provedor de um PAPEL: Gmail só quando houver credenciais daquele
// papel (com fallback p/ a conta única) E não estivermos em ensaio; caso
// contrário, simulado (que apenas loga o que faria).
export function escolherEmailProvider(papel: PapelEmail = 'followup'): EmailProvider {
  const cred = lerCredenciaisGmail(papel)
  if (cred && !engineConfig.modoEnsaio) return new GmailProvider(cred)
  if (engineConfig.modoEnsaio) log.info('Motor em MODO_ENSAIO: e-mails serão apenas simulados.')
  return new SimulatedProvider()
}

// Registra os handlers da fila (hoje: direcionar ao closer). O aviso ao closer
// sai pela conta de PROSPECÇÃO (item 2.7).
export function registrarHandlers(motor: Motor) {
  motor.fila.registrar('direcionar_closer', (p) =>
    direcionarCloser(motor.store, motor.emailProspeccao, p as { leadId: string; textoResposta: string }),
  )
}

// Monta um motor PRESO a uma organização (multi-tenant, migration 0006). O
// Store real fica escopado nessa org; os overrides (testes/scripts) seguem
// podendo injetar store/email/fila próprios.
export function criarMotor(organizacaoId: string, overrides?: Partial<Motor>): Motor {
  const motor: Motor = {
    store: overrides?.store ?? new SupabaseStore(organizacaoId),
    email: overrides?.email ?? escolherEmailProvider('followup'),
    // Prospecção: usa o override explícito; senão o mesmo `email` injetado
    // (compat. com testes que passam só `email`); senão a conta de prospecção.
    emailProspeccao: overrides?.emailProspeccao ?? overrides?.email ?? escolherEmailProvider('prospeccao'),
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
  const resp = await detectarResposta(motor.store, motor.email, motor.fila, {
    extrairContatos: extrairContatosAlternativos, // item 7 (auto-guarda se IA off)
  })
  await motor.fila.processar()
  const fu = await followUp(motor.store, motor.email)
  // Telemetria de saúde (item 2.5): carimba execução bem-sucedida do follow-up.
  // organizacaoId pode ser undefined em contexto sem org (MemoryStore/testes).
  if (motor.store.organizacaoId) await marcarExecucaoFollowup(motor.store.organizacaoId)
  const escaninho = motor.fila.escaninhoErro()
  log.info('=== Cadência diária concluída ===', {
    respostas: resp.respostas,
    ignoradas: resp.ignoradas,
    contatosAlternativos: resp.contatosAlternativos,
    followupsEnviados: fu.enviados,
    jobsComErro: escaninho.length,
  })
  return { pulado: false as const, ...resp, ...fu, jobsComErro: escaninho.length }
}

// Resolve o provedor de e-mail de ENTRADA (IMAP) para uma org.
// O workflow envia via email_conta_key (ex: 'LAUDO'); bounces e respostas
// chegam nessa mesma conta. detectarResposta precisa ler ela, não a genérica.
async function resolverEmailProviderOrg(orgId: string): Promise<EmailProvider> {
  try {
    const db = createSupabaseAdminClient()
    const { data } = await db
      .from('organizacoes')
      .select('configuracoes')
      .eq('id', orgId)
      .maybeSingle()
    const cfg = data?.configuracoes as Record<string, unknown> | null
    const nomenc = cfg?.nomenclaturas as Record<string, string> | undefined
    const emailKey = nomenc?.email_conta_key
    if (emailKey) {
      const cred = lerCredenciaisGmail(emailKey)
      if (cred && !engineConfig.modoEnsaio) return new GmailProvider(cred)
    }
  } catch {
    // sem break — cai no padrão abaixo
  }
  return escolherEmailProvider('followup')
}

// Runner multi-tenant do cron: roda a cadência diária para CADA organização
// ativa, cada uma com seu motor escopado. Um erro numa org não derruba as
// outras. É o alvo natural dos endpoints/crons (que não têm auth.uid()).
export async function cadenciaTodasOrgs(opts?: { forcar?: boolean }) {
  const orgs = await listarOrganizacoesAtivas()
  const porOrg: Record<string, unknown> = {}
  for (const org of orgs) {
    try {
      const emailProvider = await resolverEmailProviderOrg(org)
      const motor = criarMotor(org, { email: emailProvider })
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

// Healthcheck do cron (item 2.5): varre as orgs ativas e alerta as que estão com
// o follow-up parado além do limite. Independente da cadência — pensado p/ um
// cron separado, que dispara o alerta mesmo se o cron de follow-up morreu de vez.
export async function healthcheckFollowupTodasOrgs() {
  const orgs = await listarOrganizacoesAtivas()
  const email = escolherEmailProvider()
  let alertadas = 0
  for (const org of orgs) {
    if (await verificarSaudeFollowup(org, email)) alertadas++
  }
  return { organizacoes: orgs.length, alertadas }
}

// Relatório semanal (item 7): envia o resumo da semana de CADA org ativa ao
// Chico (ALERT_EMAIL). Um erro numa org não derruba as outras. Alvo de um cron
// semanal (mesmo padrão do follow-up).
export async function relatorioSemanalTodasOrgs() {
  const orgs = await listarOrganizacoesAtivas()
  const email = escolherEmailProvider('followup')
  const porOrg: Record<string, unknown> = {}
  for (const org of orgs) {
    try {
      porOrg[org] = await enviarRelatorioSemanal(org, email)
    } catch (e) {
      log.erro('Relatório semanal falhou para uma organização', {
        organizacaoId: org,
        erro: e instanceof Error ? e.message : String(e),
      })
      porOrg[org] = { erro: e instanceof Error ? e.message : String(e) }
    }
  }
  return { organizacoes: orgs.length, porOrg }
}

// PRÉVIA (item 7): gera o e-mail da 1ª org ativa SEM enviar — pra o Chico ver o
// formato antes de deixar o cron rodando sozinho.
export async function previaRelatorioSemanal() {
  const orgs = await listarOrganizacoesAtivas()
  if (orgs.length === 0) return { erro: 'Nenhuma organização ativa.' }
  const kpis = await coletarKpisSemana(orgs[0])
  return { organizacaoId: orgs[0], kpis, email: montarEmailRelatorio(kpis) }
}

// Re-exports úteis aos endpoints/testes.
export { executarAcao, detectarResposta, followUp, direcionarCloser }
