// Rota antiga do Copiloto — agora vive como aba do módulo Comercial.
import { redirect } from 'next/navigation';

export default function Page() {
  redirect('/comercial?tab=copiloto');
}
