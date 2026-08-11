// Processo comercial saiu da sidebar (consolidação 11/08): virou aba dentro de
// Configurações. A rota antiga redireciona, preservando links/bookmarks.
import { redirect } from 'next/navigation';

export default function Page() {
  redirect('/configuracoes?tab=processo');
}
