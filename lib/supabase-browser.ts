import { createBrowserClient } from '@supabase/ssr';

// Chave da preferência "Lembrar de mim" (item 3). Persistida no localStorage para
// que TODA criação do client (o mesmo em várias telas) use a mesma persistência
// de cookie — senão um refresh de página re-gravaria o cookie com o padrão.
const REMEMBER_KEY = 'prospectos_remember';

// "Lembrar de mim" REAL (não cosmético): controla a persistência do cookie de
// sessão do Supabase.
//   • Lembrar (padrão): cookie persistente (400 dias) — continua logado após
//     fechar/reabrir o navegador.
//   • Não lembrar: cookie de SESSÃO (sem Max-Age) — o navegador o descarta ao
//     fechar, exigindo novo login. Ver login/page.tsx (grava a preferência antes
//     de autenticar) e o serializer do @supabase/ssr (maxAge ausente = sessão).
export function definirLembrar(lembrar: boolean) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(REMEMBER_KEY, lembrar ? '1' : '0');
}

export function createSupabaseBrowserClient() {
  const lembrar = typeof window === 'undefined' || localStorage.getItem(REMEMBER_KEY) !== '0';
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    // Sem lembrar → maxAge undefined = cookie de sessão. Com lembrar → deixa o
    // padrão do @supabase/ssr (400 dias).
    lembrar ? undefined : { cookieOptions: { maxAge: undefined } },
  );
}
