// Configuração dinâmica do motor de cadência (tabela `configuracoes_motor`).
// Autenticação por sessão de usuário logado (mesmo padrão de /api/perfil) —
// é uma tela do app, NÃO um endpoint interno do motor (nada de x-internal-secret).
import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import { invalidarCacheConfig } from '@/lib/engine/config';

const DEFAULTS = {
  maxEnviosDia: 40,
  horasEntreFollowups: 48,
  maxFollowups: 3,
  intervaloEntreEnviosMin: 0,
  diasSemanaAtivos: [1, 2, 3, 4, 5],
  closerEmailFallback: '',
};

function parseDiasCsv(csv: unknown): number[] {
  if (typeof csv !== 'string') return DEFAULTS.diasSemanaAtivos;
  const dias = csv
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  return dias.length > 0 ? [...new Set(dias)].sort() : DEFAULTS.diasSemanaAtivos;
}

// GET — config atual (ou defaults, se a linha ainda não existir).
export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from('configuracoes_motor')
      .select('*')
      .eq('id', 1)
      .maybeSingle();
    if (error) return NextResponse.json({ erro: error.message }, { status: 500 });

    if (!data) return NextResponse.json({ ...DEFAULTS, atualizadoEm: null, atualizadoPor: null });
    return NextResponse.json({
      maxEnviosDia: data.max_envios_dia,
      horasEntreFollowups: data.horas_entre_followups,
      maxFollowups: data.max_followups,
      intervaloEntreEnviosMin: data.intervalo_entre_envios_min,
      diasSemanaAtivos: parseDiasCsv(data.dias_semana_ativos),
      closerEmailFallback: data.closer_email_fallback ?? '',
      atualizadoEm: data.atualizado_em,
      atualizadoPor: data.atualizado_por,
    });
  } catch {
    return NextResponse.json({ erro: 'Erro interno' }, { status: 500 });
  }
}

// POST — grava a config (upsert do singleton id=1) e invalida o cache do motor.
export async function POST(req: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

    const body = await req.json();
    const {
      maxEnviosDia, horasEntreFollowups, maxFollowups,
      intervaloEntreEnviosMin, diasSemanaAtivos, closerEmailFallback,
    } = body ?? {};

    const intEntre = (v: unknown, min: number, max: number) =>
      Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

    if (!intEntre(maxEnviosDia, 1, 500))
      return NextResponse.json({ erro: 'Limite diário deve ser um inteiro entre 1 e 500.' }, { status: 400 });
    if (!intEntre(horasEntreFollowups, 1, 720))
      return NextResponse.json({ erro: 'Horas entre follow-ups deve ser um inteiro entre 1 e 720.' }, { status: 400 });
    if (!intEntre(maxFollowups, 1, 10))
      return NextResponse.json({ erro: 'Máximo de follow-ups deve ser um inteiro entre 1 e 10.' }, { status: 400 });
    if (!intEntre(intervaloEntreEnviosMin, 0, 240))
      return NextResponse.json({ erro: 'Intervalo entre envios deve ser um inteiro entre 0 e 240 minutos.' }, { status: 400 });
    if (
      !Array.isArray(diasSemanaAtivos) ||
      diasSemanaAtivos.length === 0 ||
      diasSemanaAtivos.some((d) => !Number.isInteger(d) || d < 0 || d > 6)
    )
      return NextResponse.json({ erro: 'Selecione ao menos um dia da semana (valores 0-6).' }, { status: 400 });
    if (closerEmailFallback && (typeof closerEmailFallback !== 'string' || !closerEmailFallback.includes('@')))
      return NextResponse.json({ erro: 'E-mail de fallback do closer inválido.' }, { status: 400 });

    const atualizadoEm = new Date().toISOString();
    const atualizadoPor = user.email ?? user.id;

    const admin = createSupabaseAdminClient();
    const { error } = await admin.from('configuracoes_motor').upsert({
      id: 1,
      max_envios_dia: maxEnviosDia,
      horas_entre_followups: horasEntreFollowups,
      max_followups: maxFollowups,
      intervalo_entre_envios_min: intervaloEntreEnviosMin,
      dias_semana_ativos: [...new Set(diasSemanaAtivos as number[])].sort().join(','),
      closer_email_fallback: closerEmailFallback ? String(closerEmailFallback).trim() : null,
      atualizado_em: atualizadoEm,
      atualizado_por: atualizadoPor,
    });
    if (error) return NextResponse.json({ erro: error.message }, { status: 400 });

    // Reflete a mudança no motor na hora, sem esperar o TTL do cache.
    invalidarCacheConfig();

    return NextResponse.json({ ok: true, atualizadoEm, atualizadoPor });
  } catch {
    return NextResponse.json({ erro: 'Erro interno' }, { status: 500 });
  }
}
