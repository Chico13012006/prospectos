'use client';

// Conteúdo de Templates como PAINEL reutilizável (Extra do redesign): mesma
// lógica da antiga página /templates, sem o <h1> de página — passou a viver como
// aba dentro de Inteligência Comercial. Dado real do Supabase (getTemplates).
import { useState, useEffect, useMemo, useCallback } from 'react';
import { FileText, Eye, X, Loader2, Bot, Copy, FlaskConical, Check } from 'lucide-react';
import { getTemplates, criarTemplate } from '@/lib/api';
import type { Template } from '@/lib/supabase';

// Estado do editor de template/variante (A/B testing, item 6). `modo` decide se
// a chave (canal/tipo/nicho) é editável (novo) ou herdada e travada (variante).
interface EditorState {
  modo: 'novo' | 'variante';
  nome: string; tipo: string; canal: string; nicho: string; assunto: string; corpo: string;
  salvando: boolean; erro: string | null;
}

// Canais (valor cru no banco → rótulo + cor do badge).
const CANAIS: { value: string; label: string; classes: string }[] = [
  { value: 'email', label: 'E-mail', classes: 'bg-blue-500/20 text-blue-300' },
  { value: 'linkedin', label: 'LinkedIn', classes: 'bg-sky-500/20 text-sky-300' },
  { value: 'whatsapp', label: 'WhatsApp', classes: 'bg-green-500/20 text-green-300' },
  { value: 'telefone', label: 'Telefone', classes: 'bg-purple-500/20 text-purple-300' },
];
const canalInfo = (c: string) => CANAIS.find(x => x.value === c) ?? { value: c, label: c, classes: 'bg-[#252b3b] text-slate-300' };

// Segmento = coluna `nicho` (null = genérico).
const NICHO_LABEL: Record<string, string> = {
  oticas: 'Óticas', hotelaria: 'Hotelaria', varejo: 'Varejo',
  hospital: 'Hospital', industria: 'Indústria', alimentos: 'Alimentos',
};
const labelNicho = (n?: string | null) => (n ? NICHO_LABEL[n] ?? n : 'Genérico');

// Estágio = coluna `tipo`.
const TIPO_LABEL: Record<string, string> = {
  primeiro_contato: '1º contato',
  follow_up_1: 'Follow-up 1', follow_up_2: 'Follow-up 2', follow_up_3: 'Follow-up 3', follow_up_4: 'Follow-up 4',
  abertura_geral: 'Abertura geral', gancho_reuniao: 'Gancho p/ reunião',
  pedir_material: 'Pedir material', nao_e_a_pessoa: 'Não é a pessoa',
};
const labelTipo = (t: string) => TIPO_LABEL[t] ?? t;

const VARIAVEIS = ['{nome}', '{empresa}', '{segmento}', '{cidade}', '{responsavel_comercial}'];

export default function TemplatesPanel() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(false);
  const [filterCanal, setFilterCanal] = useState('');
  const [filterNicho, setFilterNicho] = useState('');
  const [filterTipo, setFilterTipo] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);

  const carregar = useCallback(() => {
    setLoading(true);
    getTemplates()
      .then(t => { setTemplates(t); setErro(false); })
      .catch(err => { console.error('Erro ao carregar templates:', err); setErro(true); })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  function abrirNovo() {
    setEditor({ modo: 'novo', nome: '', tipo: 'primeiro_contato', canal: 'email', nicho: '', assunto: '', corpo: '', salvando: false, erro: null });
  }
  function abrirVariante(t: Template) {
    // Herda a CHAVE (canal/tipo/nicho) — é o que define o grupo do A/B — e
    // pré-preenche o conteúdo pra o vendedor editar a nova variante.
    setEditor({
      modo: 'variante', nome: `${t.nome} (variante)`, tipo: t.tipo, canal: t.canal,
      nicho: t.nicho ?? '', assunto: t.assunto ?? '', corpo: t.corpo, salvando: false, erro: null,
    });
  }
  async function salvarEditor() {
    if (!editor) return;
    if (!editor.nome.trim() || !editor.corpo.trim()) {
      setEditor({ ...editor, erro: 'Nome e corpo são obrigatórios.' });
      return;
    }
    setEditor({ ...editor, salvando: true, erro: null });
    try {
      await criarTemplate({
        nome: editor.nome.trim(), tipo: editor.tipo, canal: editor.canal,
        nicho: editor.nicho || null, assunto: editor.assunto.trim() || null, corpo: editor.corpo.trim(),
      });
      setEditor(null);
      carregar();
    } catch (e) {
      setEditor({ ...editor, salvando: false, erro: e instanceof Error ? e.message : 'Erro ao salvar.' });
    }
  }

  // Opções dos selects, derivadas do que existe no banco.
  const nichosDisponiveis = useMemo(() => {
    const s = new Set(templates.map(t => t.nicho ?? '__generico__'));
    return Array.from(s);
  }, [templates]);
  const tiposDisponiveis = useMemo(() => {
    const s = new Set(templates.map(t => t.tipo));
    return Array.from(s);
  }, [templates]);

  const filtered = useMemo(() => {
    const ordemCanal = ['email', 'linkedin', 'whatsapp', 'telefone'];
    return templates
      .filter(t => !filterCanal || t.canal === filterCanal)
      .filter(t => !filterNicho || (filterNicho === '__generico__' ? !t.nicho : t.nicho === filterNicho))
      .filter(t => !filterTipo || t.tipo === filterTipo)
      .sort((a, b) =>
        (ordemCanal.indexOf(a.canal) - ordemCanal.indexOf(b.canal)) ||
        (a.nicho ?? '').localeCompare(b.nicho ?? '') ||
        a.tipo.localeCompare(b.tipo));
  }, [templates, filterCanal, filterNicho, filterTipo]);

  const previewTemplate = templates.find(t => t.id === preview);
  const temFiltro = filterCanal || filterNicho || filterTipo;

  return (
    <div className="space-y-5">
      {/* Sub-cabeçalho (sem <h1> — o título da seção é de Inteligência Comercial) */}
      <div className="flex items-center justify-between gap-4">
        <p className="text-slate-400 text-sm">
          {loading ? 'Carregando...' : `${filtered.length} de ${templates.length} templates`}
          <span className="text-slate-600"> · o motor envia só por e-mail (segmento + estágio); os demais canais são referência.</span>
        </p>
        <button onClick={abrirNovo} className="flex items-center gap-2 text-sm font-medium text-white px-4 py-2 rounded-lg shrink-0 focus-ring"
          style={{ backgroundColor: '#1e3a5f' }}>
          <FileText size={15} /> Novo Template
        </button>
      </div>

      {/* Filtros: Canal · Segmento · Estágio */}
      <div className="card p-4 flex flex-wrap gap-3 items-center">
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setFilterCanal('')}
            className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${!filterCanal ? 'border-blue-300 bg-blue-500/10 text-blue-400' : 'border-[var(--border)] text-slate-300 hover:bg-[var(--bg-base)]'}`}
          >
            Todos canais
          </button>
          {CANAIS.map(c => (
            <button
              key={c.value}
              onClick={() => setFilterCanal(filterCanal === c.value ? '' : c.value)}
              className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${filterCanal === c.value ? 'border-blue-300 bg-blue-500/10 text-blue-400' : 'border-[var(--border)] text-slate-300 hover:bg-[var(--bg-base)]'}`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="h-4 w-px bg-[var(--border)]" />
        <select value={filterNicho} onChange={e => setFilterNicho(e.target.value)}
          className="text-sm border border-[var(--border)] rounded-lg px-3 py-1.5 text-slate-300 focus:outline-none bg-[var(--bg-card)]">
          <option value="">Todos os segmentos</option>
          {nichosDisponiveis.map(n => <option key={n} value={n}>{n === '__generico__' ? 'Genérico' : labelNicho(n)}</option>)}
        </select>
        <select value={filterTipo} onChange={e => setFilterTipo(e.target.value)}
          className="text-sm border border-[var(--border)] rounded-lg px-3 py-1.5 text-slate-300 focus:outline-none bg-[var(--bg-card)]">
          <option value="">Todos os estágios</option>
          {tiposDisponiveis.map(t => <option key={t} value={t}>{labelTipo(t)}</option>)}
        </select>
        {temFiltro && (
          <button onClick={() => { setFilterCanal(''); setFilterNicho(''); setFilterTipo(''); }}
            className="text-xs text-slate-400 hover:text-slate-200 underline">
            Limpar
          </button>
        )}
      </div>

      {/* Conteúdo */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-slate-500">
          <Loader2 size={18} className="animate-spin" /> <span className="text-sm">Carregando templates...</span>
        </div>
      ) : erro ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-500 gap-2">
          <span className="text-sm font-medium text-slate-400">Sem conexão com os dados.</span>
          <span className="text-xs">Verifique a conexão com o Supabase.</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center text-slate-500 text-sm">Nenhum template com esses filtros.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map(t => {
            const ci = canalInfo(t.canal);
            return (
              <div key={t.id} className="card overflow-hidden">
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-slate-100 leading-tight">{t.nome}</h3>
                      {t.assunto && <div className="text-xs text-slate-400 mt-1">✉ {t.assunto}</div>}
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full shrink-0 ${ci.classes}`}>{ci.label}</span>
                  </div>

                  {/* Badges: segmento + estágio */}
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    <span className="text-xs bg-[#252b3b] text-slate-300 px-2 py-0.5 rounded-full">{labelNicho(t.nicho)}</span>
                    <span className="text-xs bg-indigo-500/15 text-indigo-300 px-2 py-0.5 rounded-full">{labelTipo(t.tipo)}</span>
                  </div>

                  <div className="text-xs text-slate-400 bg-[var(--bg-base)] rounded-lg p-3 line-clamp-3 leading-relaxed border border-[var(--border)] whitespace-pre-wrap">
                    {t.corpo}
                  </div>
                </div>

                <div className="px-4 py-3 border-t border-[var(--border)] flex items-center justify-between bg-[var(--bg-base)]/50">
                  <span className="text-xs text-slate-500">{t.canal === 'email' ? 'Enviado pelo motor' : 'Referência (manual)'}</span>
                  <div className="flex items-center gap-3">
                    {t.canal === 'email' && (
                      <button
                        onClick={() => abrirVariante(t)}
                        title="Criar uma variante para A/B testing (o motor alterna entre as variantes por lead)"
                        className="flex items-center gap-1 text-xs text-fuchsia-400 hover:text-fuchsia-300 font-medium focus-ring rounded"
                      >
                        <FlaskConical size={13} /> Variante A/B
                      </button>
                    )}
                    <button
                      onClick={() => setPreview(t.id)}
                      className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 font-medium focus-ring rounded"
                    >
                      <Eye size={13} /> Preview
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Preview Modal */}
      {previewTemplate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setPreview(null)}>
          <div className="bg-[#1a1f2e] rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-bold text-lg text-slate-100">{previewTemplate.nome}</h3>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${canalInfo(previewTemplate.canal).classes}`}>{canalInfo(previewTemplate.canal).label}</span>
                  <span className="text-xs bg-[#252b3b] text-slate-300 px-2 py-0.5 rounded-full">{labelNicho(previewTemplate.nicho)}</span>
                  <span className="text-xs bg-indigo-500/15 text-indigo-300 px-2 py-0.5 rounded-full">{labelTipo(previewTemplate.tipo)}</span>
                </div>
              </div>
              <button onClick={() => setPreview(null)} className="text-slate-500 hover:text-slate-300 focus-ring rounded" aria-label="Fechar preview"><X size={20} /></button>
            </div>

            {previewTemplate.assunto && (
              <div className="mb-3 bg-[#0f1117] rounded-lg px-3 py-2 text-sm">
                <span className="text-slate-400 font-medium">Assunto: </span>
                <span className="text-slate-200">{previewTemplate.assunto}</span>
              </div>
            )}

            <div className="bg-[#0f1117] rounded-xl p-4 text-sm text-slate-200 whitespace-pre-wrap leading-relaxed border border-[#2a3147]">
              {previewTemplate.corpo}
            </div>

            {previewTemplate.canal === 'email' && previewTemplate.tipo.startsWith('follow_up') && (
              <div className="mt-3 p-3 bg-amber-500/10 rounded-lg border border-amber-500/20 text-xs text-amber-300 flex items-start gap-1.5">
                <Bot size={13} className="mt-0.5 shrink-0" />
                <span>No envio, o motor usa o assunto do 1º contato deste lead com “Re:” para manter a mesma thread.</span>
              </div>
            )}

            <div className="mt-4 p-3 bg-blue-500/10 rounded-lg border border-blue-500/20">
              <div className="text-xs font-semibold text-blue-400 mb-1.5">Variáveis disponíveis:</div>
              <div className="flex flex-wrap gap-2">
                {VARIAVEIS.map(v => (
                  <code key={v} className="text-xs bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded">{v}</code>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Editor de template / variante A/B (item 6) */}
      {editor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setEditor(null)}>
          <div className="bg-[#1a1f2e] rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-bold text-lg text-slate-100 flex items-center gap-2">
                  {editor.modo === 'variante' ? <><FlaskConical size={17} className="text-fuchsia-400" /> Nova variante A/B</> : <><FileText size={17} /> Novo template</>}
                </h3>
                {editor.modo === 'variante' && (
                  <p className="text-xs text-slate-500 mt-1">Mesma chave (canal · estágio · segmento); o motor vai alternar entre as variantes por lead.</p>
                )}
              </div>
              <button onClick={() => setEditor(null)} className="text-slate-500 hover:text-slate-300"><X size={20} /></button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-400 block mb-1">Nome</label>
                <input value={editor.nome} onChange={e => setEditor({ ...editor, nome: e.target.value })}
                  placeholder="Ex.: 1º contato — variante B (mais direto)"
                  className="w-full text-sm border border-[#2a3147] rounded-lg px-3 py-2 bg-[#0f1117] text-slate-100 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
              </div>

              {/* Chave: editável no novo, travada na variante */}
              <div className="grid grid-cols-3 gap-2">
                {editor.modo === 'novo' ? (
                  <>
                    <SelectCampo label="Canal" value={editor.canal} onChange={v => setEditor({ ...editor, canal: v })}
                      opcoes={CANAIS.map(c => ({ value: c.value, label: c.label }))} />
                    <SelectCampo label="Estágio" value={editor.tipo} onChange={v => setEditor({ ...editor, tipo: v })}
                      opcoes={Object.keys(TIPO_LABEL).map(t => ({ value: t, label: labelTipo(t) }))} />
                    <SelectCampo label="Segmento" value={editor.nicho} onChange={v => setEditor({ ...editor, nicho: v })}
                      opcoes={[{ value: '', label: 'Genérico' }, ...Object.keys(NICHO_LABEL).map(n => ({ value: n, label: labelNicho(n) }))]} />
                  </>
                ) : (
                  <>
                    {[['Canal', canalInfo(editor.canal).label], ['Estágio', labelTipo(editor.tipo)], ['Segmento', labelNicho(editor.nicho || null)]].map(([l, v]) => (
                      <div key={l}>
                        <label className="text-xs font-medium text-slate-400 block mb-1">{l}</label>
                        <div className="text-sm border border-[#2a3147] rounded-lg px-3 py-2 bg-[#0f1117] text-slate-400 truncate">{v}</div>
                      </div>
                    ))}
                  </>
                )}
              </div>

              <div>
                <label className="text-xs font-medium text-slate-400 block mb-1">Assunto <span className="text-slate-600">(e-mail)</span></label>
                <input value={editor.assunto} onChange={e => setEditor({ ...editor, assunto: e.target.value })}
                  placeholder="{empresa} — perdas no estoque"
                  className="w-full text-sm border border-[#2a3147] rounded-lg px-3 py-2 bg-[#0f1117] text-slate-100 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-400 block mb-1">Corpo</label>
                <textarea value={editor.corpo} onChange={e => setEditor({ ...editor, corpo: e.target.value })} rows={7}
                  placeholder="Escreva o texto. Use variáveis como {nome}, {empresa}..."
                  className="w-full text-sm border border-[#2a3147] rounded-lg px-3 py-2 bg-[#0f1117] text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-y" />
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {VARIAVEIS.map(v => <code key={v} className="text-[11px] bg-blue-500/15 text-blue-300 px-1.5 py-0.5 rounded">{v}</code>)}
                </div>
              </div>

              {editor.erro && <p className="text-sm text-red-400">{editor.erro}</p>}

              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => setEditor(null)} className="text-sm font-medium text-slate-300 px-4 py-2 rounded-lg border border-[#2a3147] hover:bg-[#252b3b] transition-colors">Cancelar</button>
                <button onClick={salvarEditor} disabled={editor.salvando}
                  className="flex items-center gap-1.5 text-sm font-semibold text-white px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                  {editor.salvando ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  {editor.salvando ? 'Salvando...' : (editor.modo === 'variante' ? 'Criar variante' : 'Criar template')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SelectCampo({ label, value, onChange, opcoes }: {
  label: string; value: string; onChange: (v: string) => void; opcoes: { value: string; label: string }[];
}) {
  return (
    <div>
      <label className="text-xs font-medium text-slate-400 block mb-1">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full text-sm border border-[#2a3147] rounded-lg px-2 py-2 bg-[#0f1117] text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500">
        {opcoes.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
