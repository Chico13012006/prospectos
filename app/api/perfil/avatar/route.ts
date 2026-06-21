import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

    const formData = await req.formData();
    const file = formData.get('file') as File;
    if (!file) return NextResponse.json({ erro: 'Arquivo obrigatório' }, { status: 400 });

    const ext = file.name.split('.').pop();
    const path = `avatars/${user.id}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const admin = createSupabaseAdminClient();

    // Fazer upload para Supabase Storage (bucket: avatars)
    const { error: uploadError } = await admin.storage
      .from('avatars')
      .upload(path, buffer, {
        contentType: file.type,
        upsert: true,
      });

    if (uploadError) return NextResponse.json({ erro: uploadError.message }, { status: 400 });

    // Gerar URL pública
    const { data: urlData } = admin.storage.from('avatars').getPublicUrl(path);
    const avatar_url = urlData.publicUrl;

    // Salvar URL no perfil
    await admin.from('perfis').upsert({ id: user.id, avatar_url });

    return NextResponse.json({ ok: true, avatar_url });
  } catch {
    return NextResponse.json({ erro: 'Erro interno' }, { status: 500 });
  }
}
