// Rota antiga do Simulador — agora vive como aba do módulo Comercial. Redireciona
// preservando o pré-preenchimento (?modelo/?itens) do deep-link do copiloto.
import { redirect } from 'next/navigation';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams({ tab: 'simulador' });
  if (typeof sp.modelo === 'string') qs.set('modelo', sp.modelo);
  if (typeof sp.itens === 'string') qs.set('itens', sp.itens);
  redirect(`/comercial?${qs.toString()}`);
}
