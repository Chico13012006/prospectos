// Campanhas saiu da sidebar (consolidação 11/08): agora é aba dentro de Automação.
// A rota antiga redireciona, preservando links/bookmarks existentes.
import { redirect } from 'next/navigation';

export default function Page() {
  redirect('/automacao?tab=campanhas');
}
