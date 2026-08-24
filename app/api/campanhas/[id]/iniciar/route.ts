// Início REAL da campanha pelo wizard. Publica a versão em dry-run, recalcula
// o público confirmado, cria as execuções e agenda somente essas execuções para
// processamento após a resposta. Falha no processador não reverte o enrollment;
// o cron existente continua sendo o fallback.
import { after, NextResponse } from 'next/server'
import { exigirPermissao } from '@/lib/rbac/servidor'
import { iniciarCampanhaReal } from '@/lib/campanhas/ativacaoServidor'
import {
  AmbienteSupabase,
  processarExecucoesCampanha,
  registrarBlocosPadrao,
  SupabaseWorkflowStore,
} from '@/lib/workflows'

export const runtime = 'nodejs'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const acc = await exigirPermissao('campaigns.manage')
  if ('erro' in acc) return acc.erro

  try {
    const body = await req.json().catch(() => ({}))
    const { execucoes_criadas: execucaoIds, ...resultado } = await iniciarCampanhaReal(
      acc.acesso.admin,
      acc.acesso.org,
      id,
      acc.acesso.user.id,
      typeof body.confirmarQuantidade === 'number' ? body.confirmarQuantidade : undefined,
    )
    const { admin, org } = acc.acesso
    after(async () => {
      try {
        await processarExecucoesCampanha(
          new SupabaseWorkflowStore(org, admin),
          registrarBlocosPadrao(),
          new AmbienteSupabase(org, { client: admin }),
          id,
          execucaoIds,
        )
      } catch (erro) {
        console.error('[campanhas/iniciar] processamento restrito falhou; o cron fará nova tentativa', {
          campanhaId: id,
          erro: erro instanceof Error ? erro.message : String(erro),
        })
      }
    })
    return NextResponse.json({ ok: true, ...resultado })
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : 'Erro' }, { status: 400 })
  }
}
