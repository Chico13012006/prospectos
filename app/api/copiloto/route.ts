// Copiloto pós-reunião (sprint item 8). Recebe a transcrição colada + o lead,
// chama a IA (papel "copiloto", provider conforme AI_PROVIDER) e devolve a
// análise estruturada. Auth por sessão; o lead (para contexto) é lido escopado
// à organização do usuário. SERVER-ONLY.
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { iaConfigurada } from '@/lib/ia/cliente'
import { analisarReuniao, type ContextoLeadCopiloto } from '@/lib/ia/copilotoReuniao'
import { ErroJsonEstruturado } from '@/lib/ia/jsonEstruturado'

export const runtime = 'nodejs'

// A análise com Opus leva ~20 s para uma transcrição de 6 mil caracteres e
// 30–40 s para uma reunião real (até 24 mil). Sem isto a função cai no limite
// padrão da Vercel (10–15 s) e morre antes de responder: o cliente recebe um
// 504 em HTML e a tela mostra só "Erro 504". 60 s é o teto do plano Hobby e
// cobre o pior caso com folga.
export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    if (!iaConfigurada()) {
      // Motivo só no log do servidor; o frontend recebe mensagem neutra.
      console.error('[copiloto POST] IA não configurada: falta a chave de API do provider ativo.')
      return NextResponse.json({ erro: 'IA não configurada.' }, { status: 503 })
    }
    const server = await createSupabaseServerClient()
    const { data: { user } } = await server.auth.getUser()
    if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })

    const admin = createSupabaseAdminClient()
    const { data: perfil } = await admin
      .from('perfis').select('organizacao_id').eq('id', user.id).maybeSingle()
    const org = perfil?.organizacao_id as string | undefined
    if (!org) return NextResponse.json({ erro: 'Usuário sem organização' }, { status: 400 })

    const body = await req.json().catch(() => null)
    const transcricao = String(body?.transcricao ?? '').trim()
    const leadId = body?.leadId ? String(body.leadId) : null
    if (transcricao.length < 20) {
      return NextResponse.json({ erro: 'Cole a transcrição da reunião (texto muito curto).' }, { status: 400 })
    }

    // Contexto do lead (opcional) — só se o lead for da org do usuário.
    let contexto: ContextoLeadCopiloto | undefined
    if (leadId) {
      const [leadQ, historicoQ] = await Promise.all([
        admin
          .from('leads')
          .select('empresa, segmento, cidade, estado, contato_nome, contato_cargo, origem, estagio, ultimo_contato, proxima_acao, proxima_acao_data, responsavel_id, responsavel_nome')
          .eq('id', leadId).eq('organizacao_id', org).maybeSingle(),
        admin
          .from('interacoes')
          .select('tipo, canal, descricao, created_at')
          .eq('lead_id', leadId).eq('organizacao_id', org)
          .order('created_at', { ascending: false }).limit(8),
      ])
      if (leadQ.error) throw leadQ.error
      if (historicoQ.error) throw historicoQ.error

      const lead = leadQ.data
      let responsavel = lead?.responsavel_nome ?? null
      if (lead?.responsavel_id) {
        const { data: usuario, error: usuarioError } = await admin
          .from('usuarios').select('nome')
          .eq('id', lead.responsavel_id).eq('organizacao_id', org).maybeSingle()
        if (usuarioError) throw usuarioError
        responsavel = usuario?.nome ?? responsavel
      }

      if (lead) {
        contexto = {
          empresa: lead.empresa,
          segmento: lead.segmento,
          cidade: lead.cidade,
          estado: lead.estado,
          contato: lead.contato_nome,
          cargo: lead.contato_cargo,
          origem: lead.origem,
          estagioAtual: lead.estagio,
          ultimoContato: lead.ultimo_contato,
          proximaAcao: lead.proxima_acao,
          proximaAcaoEm: lead.proxima_acao_data,
          responsavel,
          historico: (historicoQ.data ?? []).map((interacao) => ({
            tipo: interacao.tipo,
            canal: interacao.canal,
            descricao: interacao.descricao ?? '',
            realizadaEm: interacao.created_at,
          })),
        }
      }
    }

    const analise = await analisarReuniao(transcricao, contexto)
    return NextResponse.json({ analise })
  } catch (err) {
    console.error('[copiloto POST] erro:', err)
    return respostaDeErroIa(err) ?? NextResponse.json({ erro: 'Erro ao analisar a reunião.' }, { status: 500 })
  }
}

// Tradução neutra (OpenAI ou Anthropic) das falhas da IA que a pessoa consegue
// agir sobre. Erros HTTP dos SDKs trazem `status`; falhas validadas pela camada
// central (recusa, resposta incompleta, JSON inválido) são ErroJsonEstruturado.
// Nunca cita variável de ambiente, chave ou detalhe interno. Não usa 502/504:
// o cliente (lib/api.ts) trata esses status como estouro de tempo da Vercel.
function respostaDeErroIa(err: unknown): NextResponse | null {
  const status = err instanceof Error ? (err as { status?: unknown }).status : undefined
  if (status === 401 || status === 403) {
    return NextResponse.json({ erro: 'Chave da IA inválida ou revogada.' }, { status: 503 })
  }
  if (status === 429) {
    return NextResponse.json({ erro: 'Limite de uso da IA atingido. Tente novamente em alguns instantes.' }, { status: 429 })
  }
  if (typeof status === 'number' || err instanceof ErroJsonEstruturado) {
    return NextResponse.json({ erro: 'A IA recusou a requisição.' }, { status: 500 })
  }
  return null
}
