// FLUXO 2 (+3) — Detectar resposta e processar a fila (encaminhar ao closer).
import { NextResponse } from 'next/server'
import { autorizar } from '@/lib/engine/http'
import { criarMotor, detectarResposta, listarOrganizacoesAtivas } from '@/lib/engine'
import { extrairContatosAlternativos } from '@/lib/ia/contatosAlternativos'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const negado = autorizar(req)
  if (negado) return negado
  try {
    // Multi-tenant: varre cada organização ativa com seu motor escopado. Cada
    // uma só casa respostas com os próprios leads (o Store filtra por org).
    const orgs = await listarOrganizacoesAtivas()
    const porOrg: Record<string, unknown> = {}
    for (const org of orgs) {
      const motor = criarMotor(org)
      const r = await detectarResposta(motor.store, motor.email, motor.fila, {
        extrairContatos: extrairContatosAlternativos, // item 7
      })
      await motor.fila.processar() // dispara o Fluxo 3 para cada resposta
      porOrg[org] = { ...r, jobsComErro: motor.fila.escaninhoErro().length }
    }
    return NextResponse.json({ organizacoes: orgs.length, porOrg })
  } catch (err) {
    console.error('[engine/detectar-resposta] erro:', err)
    return NextResponse.json({ erro: 'Erro interno do motor' }, { status: 500 })
  }
}
