// Backfill do lead scoring dinâmico (sprint item 2.8). Recalcula leads.score
// substituindo o valor fixo (50) pelo score real: quem respondeu ganha bônus, e
// quanto mais rápido respondeu (resposta − último contato enviado), maior.
//
// Reusa lib/engine/scoring.ts (mesma fórmula do recálculo em tempo real do
// detectarResposta). Idempotente: recalcula sempre a partir das interações, só
// grava quando o score muda. Rodar uma vez após aplicar o item:
//   npx tsx scripts/backfill-lead-scores.ts
import { bootstrapEnv } from './_bootstrap'

bootstrapEnv()

import { createSupabaseAdminClient } from '../lib/supabase-admin'
import { calcularScore, horasEntre } from '../lib/engine/scoring'

const ESTAGIOS_RESPONDIDO = ['interessado', 'respondeu', 'com_closer', 'reuniao_agendada', 'ganho']
const TIPOS_ENVIO = ['abordagem', 'follow_up', 'follow_up_1', 'follow_up_2', 'follow_up_3', 'follow_up_4']

async function main() {
  const db = createSupabaseAdminClient()

  const { data: leads, error: e1 } = await db.from('leads').select('id, estagio, score')
  if (e1) throw e1
  const { data: interacoes, error: e2 } = await db
    .from('interacoes')
    .select('lead_id, tipo, created_at')
  if (e2) throw e2

  // Agrupa interações por lead.
  const porLead = new Map<string, { tipo: string; created_at: string }[]>()
  for (const it of interacoes ?? []) {
    const arr = porLead.get(it.lead_id) ?? []
    arr.push({ tipo: it.tipo, created_at: it.created_at })
    porLead.set(it.lead_id, arr)
  }

  let atualizados = 0
  const amostra: string[] = []

  for (const lead of leads ?? []) {
    const its = porLead.get(lead.id) ?? []
    const respostas = its
      .filter((i) => i.tipo === 'resposta')
      .sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at))

    let respondeu = false
    let horas: number | null = null

    if (respostas.length > 0) {
      respondeu = true
      const primeira = respostas[0]
      // último envio ANTES da 1ª resposta → mede a velocidade real.
      const envioAntes = its
        .filter((i) => TIPOS_ENVIO.includes(i.tipo) && new Date(i.created_at) < new Date(primeira.created_at))
        .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))[0]
      horas = envioAntes ? horasEntre(envioAntes.created_at, primeira.created_at) : null
    } else if (ESTAGIOS_RESPONDIDO.includes(lead.estagio)) {
      // Respondeu (estágio manual) mas sem interação de resposta registrada.
      respondeu = true
    }

    const novo = calcularScore({ respondeu, horasAteResposta: horas })
    if (novo !== lead.score) {
      const { error } = await db.from('leads').update({ score: novo }).eq('id', lead.id)
      if (error) throw error
      atualizados++
      if (amostra.length < 10) amostra.push(`${lead.id.slice(0, 8)} ${lead.score}→${novo}${horas != null ? ` (${horas.toFixed(1)}h)` : ''}`)
    }
  }

  console.log(`Leads: ${leads?.length ?? 0} | scores atualizados: ${atualizados}`)
  console.log('Amostra:', amostra.join(' | ') || '(nenhum)')
}

main().catch((e) => {
  console.error('backfill-lead-scores falhou:', e)
  process.exit(1)
})
