'use client';

import { Suspense, useState, useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Calculator, FolderOpen, Sparkles, FileText } from 'lucide-react';
import { AbasModulo, PaginaModulo } from '@/components/tema/Modulo';
import SimuladorPanel from '@/components/comercial/SimuladorPanel';
import PropostasPanel from '@/components/comercial/PropostasPanel';
import CopilotoPanel from '@/components/comercial/CopilotoPanel';
import TemplatesPanel from '@/components/templates/TemplatesPanel';

// Módulo "Comercial": junta o Simulador de propostas, as Propostas salvas, o
// Copiloto pós-reunião e a biblioteca de Templates em abas internas
// (?tab=simulador|propostas|copiloto|templates), um único item na navegação. O
// TemplatesPanel é o mesmo usado em Automação > Modelos — painel compartilhado,
// não uma segunda cópia.
// useSearchParams() exige limite de Suspense (Next) — conteúdo real em Inner.
export default function ComercialPage() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}

type Aba = 'simulador' | 'propostas' | 'copiloto' | 'templates';

const ABAS: readonly Aba[] = ['simulador', 'propostas', 'copiloto', 'templates'];
const ehAba = (valor: string | null): valor is Aba => !!valor && (ABAS as readonly string[]).includes(valor);

function Inner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [aba, setAba] = useState<Aba>('simulador');

  // Deep-link: ?tab=simulador|propostas|copiloto|templates (nav, redirect de
  // /templates, link "Ver propostas" ou externo). O simulador também lê
  // ?modelo/?itens (vindo do copiloto).
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (ehAba(tab)) setAba(tab);
  }, [searchParams]);

  // Trocar de aba grava ?tab na URL (preservando ?modelo/?itens), para que um
  // link interno para outra aba sempre funcione, mesmo depois de clicar aqui.
  function irPara(id: Aba) {
    setAba(id);
    const sp = new URLSearchParams(searchParams.toString());
    sp.set('tab', id);
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  }

  return (
    <PaginaModulo
      grupo="Gestão"
      titulo="Comercial"
      subtitulo="Simulador e propostas salvas, copiloto pós-reunião e biblioteca de templates."
      abas={
        <AbasModulo
          rotulo="Seções do Comercial"
          ativa={aba}
          onChange={irPara}
          abas={[
            { id: 'simulador', label: 'Simulador', Icon: Calculator },
            { id: 'propostas', label: 'Propostas', Icon: FolderOpen },
            { id: 'copiloto', label: 'Copiloto', Icon: Sparkles },
            { id: 'templates', label: 'Templates', Icon: FileText },
          ]}
        />
      }
    >
      <div className="animate-in">
        {aba === 'simulador' && <SimuladorPanel />}
        {aba === 'propostas' && <PropostasPanel />}
        {aba === 'copiloto' && <CopilotoPanel />}
        {aba === 'templates' && <TemplatesPanel />}
      </div>
    </PaginaModulo>
  );
}
