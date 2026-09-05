// Templates deixou de ser item isolado na sidebar e, desde a saída da aba de ROI,
// vive dentro do módulo Comercial. A rota antiga redireciona para lá, preservando
// links/bookmarks existentes.
import { redirect } from 'next/navigation';

export default function Page() {
  redirect('/comercial?tab=templates');
}
