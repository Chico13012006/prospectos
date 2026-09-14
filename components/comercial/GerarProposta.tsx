'use client';

import { useState } from 'react';
import { FileDown, Loader2 } from 'lucide-react';
import { PROPOSTA_LIMITE_ITENS } from '@/lib/proposta/config';
import { nomeArquivoProposta, type PropostaPdfData } from '@/lib/proposta/dados';

// Ação "Gerar proposta" do card Resumo (Comercial > Simulador). O renderizador
// (pdf-lib) só é carregado no clique — import dinâmico — para não pesar a
// tela. Download pelo mesmo padrão do export CSV (Blob + <a download>).
export default function GerarProposta({ dados, empresa }: {
  dados: PropostaPdfData;
  // Nome do lead selecionado em "Registrar no lead"; só entra no nome do arquivo.
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
      const { gerarPropostaPdf } = await import('@/lib/proposta/renderizarPdf');
      const bytes = await gerarPropostaPdf(dados, carregarAssetPublico);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = nomeArquivoProposta(empresa);
      link.click();
      URL.revokeObjectURL(url);
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

// Assets de public/ via fetch; 404 vira `null` (thumbnail ausente não falha).
async function carregarAssetPublico(caminho: string): Promise<Uint8Array | null> {
  const r = await fetch(caminho);
  if (!r.ok) return null;
  return new Uint8Array(await r.arrayBuffer());
}
