'use client';

import { useState } from 'react';
import { FileDown, Loader2 } from 'lucide-react';
import { PROPOSTA_LIMITE_ITENS } from '@/lib/proposta/config';
import type { PropostaPdfData } from '@/lib/proposta/dados';
import { baixarPropostaPdf } from '@/lib/proposta/baixarPdfNavegador';

// Ação "Gerar proposta" do card Resumo (Comercial > Simulador): baixa o PDF da
// proposta que está na tela, sem salvar nada (lib/proposta/baixarPdfNavegador).
export default function GerarProposta({ dados, empresa }: {
  dados: PropostaPdfData;
  // Nome do lead selecionado no card; só entra no nome do arquivo.
  empresa?: string | null;
}) {
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // A página tem uma região fixa para a lista: acima do limite não geramos
  // PDF quebrado nem segunda página — o botão trava com aviso.
  const excedeLimite = dados.equipamentos.length > PROPOSTA_LIMITE_ITENS;

  async function gerar() {
    setGerando(true);
    setErro(null);
    try {
      await baixarPropostaPdf(dados, empresa);
    } catch (e) {
      console.error('Erro ao gerar proposta:', e);
      setErro('Não foi possível gerar a proposta. Tente novamente.');
    } finally {
      setGerando(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={gerar}
        disabled={gerando || excedeLimite}
        className="w-full flex items-center justify-center gap-1.5 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 py-2 rounded-lg transition-colors"
      >
        {gerando ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
        {gerando ? 'Gerando proposta...' : 'Gerar proposta'}
      </button>
      {excedeLimite && (
        <p className="text-xs text-amber-400">
          A proposta em PDF comporta até {PROPOSTA_LIMITE_ITENS} tipos de equipamento. Reduza a seleção para gerar.
        </p>
      )}
      {erro && <p className="text-xs text-rose-400">{erro}</p>}
    </div>
  );
}
