// ROI deixou de ser módulo isolado (consolidação 11/08): virou visão de analytics
// dentro de Inteligência Comercial. A rota antiga redireciona.
import { redirect } from 'next/navigation';

export default function Page() {
  redirect('/inteligencia-comercial?tab=roi');
}
