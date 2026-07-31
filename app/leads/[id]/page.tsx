// Esta rota antiga era uma página cheia 100% sobre dado MOCK (useApp/AppContext),
// nunca migrada para dados reais. O painel REAL do lead é o LeadPanel, aberto no
// Pipeline via ?lead=<id>. Aqui só redirecionamos para lá — nada de recriar UI.
import { redirect } from 'next/navigation';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/pipeline?lead=${id}`);
}
