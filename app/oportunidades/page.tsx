// Oportunidades deixou de ser página independente (consolidação 11/08): seu dono
// único é o módulo Comercial (aba Oportunidades). A rota antiga redireciona.
import { redirect } from 'next/navigation';

export default function Page() {
  redirect('/comercial?tab=oportunidades');
}
