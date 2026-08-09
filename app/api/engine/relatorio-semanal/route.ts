// Relatório semanal por e-mail (item 7). Cron semanal envia o resumo da semana
// de cada org ao Chico. `?modo=previa` GERA o e-mail (1ª org) SEM enviar — pra
// ver o formato antes de deixar rodando sozinho.
import { NextResponse } from 'next/server'
import { autorizar } from '@/lib/engine/http'
import { relatorioSemanalTodasOrgs, previaRelatorioSemanal } from '@/lib/engine'

export const runtime = 'nodejs'

async function executar(req: Request) {
  const negado = autorizar(req)
  if (negado) return negado
  const modo = new URL(req.url).searchParams.get('modo')
  try {
    if (modo === 'previa') {
      return NextResponse.json(await previaRelatorioSemanal())
    }
    return NextResponse.json(await relatorioSemanalTodasOrgs())
  } catch (err) {
    console.error('[engine/relatorio-semanal] erro:', err)
    return NextResponse.json({ erro: 'Erro ao gerar o relatório semanal' }, { status: 500 })
  }
}

// POST p/ chamadas internas; GET p/ o Vercel Cron.
export const POST = executar
export const GET = executar
