// Templates deixou de ser item isolado na sidebar (Extra do redesign): agora vive
// como aba dentro de Inteligência Comercial. A rota antiga redireciona para lá,
// preservando links/bookmarks existentes.
import { redirect } from 'next/navigation';

export default function Page() {
  redirect('/inteligencia-comercial?tab=templates');
}
