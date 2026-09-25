'use client';

import { useState, useEffect, useCallback } from 'react';
import { Mail, Check, Loader2, Save, AlertTriangle, CheckCircle2 } from 'lucide-react';

// E-mail de prospecção: remetente DEDICADO desta organização. Reusa a mesma
// arquitetura já usada por campanhas/convite de equipe — `nomenclaturas.
// email_conta_key` (organizacoes.configuracoes) aponta para as credenciais
// GMAIL_USER_<CHAVE>/GMAIL_APP_PASSWORD_<CHAVE> provisionadas no ambiente
// (lib/engine/email/gmailProvider.ts). Esta tela não faz OAuth nem guarda
// senha — só ESCOLHE, por organização, qual conta já provisionada usar.
// Sem chave configurada aqui, campanhas de prospecção ficam bloqueadas para
// ativação/envio real (lib/campanhas/opcoesServidor.ts, lib/workflows/ambiente.ts).

interface StatusRemetente {
  contaKey: string | null;
  email: string | null;
  conectado: boolean;
}

export default function EmailProspeccaoPanel() {
  const [contaKey, setContaKey] = useState('');
  const [contaKeySalva, setContaKeySalva] = useState('');
  const [nomenclaturas, setNomenclaturas] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<StatusRemetente | null>(null);
  const [podeEditar, setPodeEditar] = useState(false);
  const [editando, setEditando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    const res = await fetch('/api/configuracoes/workspace');
    if (!res.ok) { setErro('Não foi possível carregar a configuração de e-mail.'); return; }
    const j = await res.json();
    setPodeEditar(!!j.podeEditar);
    const nomen = (j.config?.nomenclaturas && typeof j.config.nomenclaturas === 'object') ? j.config.nomenclaturas : {};
    setNomenclaturas(nomen);
    const chave = typeof nomen.email_conta_key === 'string' ? nomen.email_conta_key : '';
    setContaKey(chave); setContaKeySalva(chave);
    setStatus(j.remetenteProspeccao ?? null);
    setEditando(!chave);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  async function salvar() {
    if (salvando || !podeEditar) return;
    setSalvando(true); setErro(null); setSalvo(false);
    try {
      const chave = contaKey.trim();
      const proximo = { ...nomenclaturas };
      if (chave) proximo.email_conta_key = chave; else delete proximo.email_conta_key;
      const res = await fetch('/api/configuracoes/workspace', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nomenclaturas: proximo }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setErro(j?.erro ?? 'Não foi possível salvar.');
        return;
      }
      const j = await res.json();
      const nomen = (j.config?.nomenclaturas && typeof j.config.nomenclaturas === 'object') ? j.config.nomenclaturas : {};
      setNomenclaturas(nomen);
      const chaveSalva = typeof nomen.email_conta_key === 'string' ? nomen.email_conta_key : '';
      setContaKey(chaveSalva); setContaKeySalva(chaveSalva);
      setStatus(j.remetenteProspeccao ?? null);
      setSalvo(true); setEditando(false);
      setTimeout(() => setSalvo(false), 2500);
    } finally { setSalvando(false); }
  }

  const conectado = status?.conectado === true;
  const input = 'flex-1 bg-[var(--bg-base)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 disabled:opacity-50';

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-6 space-y-4 max-w-2xl">
      <div>
        <div className="font-semibold text-slate-100 inline-flex items-center gap-2">
          <Mail size={16} className="text-indigo-300" /> E-mail de prospecção
        </div>
        <p className="text-sm text-slate-400 mt-1">
          Remetente padrão desta organização para as campanhas de prospecção. Sem uma conta
          configurada aqui, a ativação e o envio real de prospecção ficam bloqueados — nunca
          usam, em silêncio, a conta de outra organização.
        </p>
      </div>

      {!podeEditar && (
        <div className="text-xs text-amber-400">Somente leitura — requer a permissão workspace.configure para editar.</div>
      )}

      {status === null ? (
        <div className="text-sm text-slate-500 inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Carregando…</div>
      ) : (
        <div className="rounded-lg border border-[var(--border)] p-4 space-y-2">
          <div className="flex items-center gap-2">
            {conectado ? (
              <span className="text-xs px-2 py-0.5 rounded-full border border-green-500/40 bg-green-500/15 text-green-300 inline-flex items-center gap-1">
                <CheckCircle2 size={12} /> Conectado
              </span>
            ) : status.contaKey ? (
              <span className="text-xs px-2 py-0.5 rounded-full border border-red-500/40 bg-red-500/15 text-red-300 inline-flex items-center gap-1">
                <AlertTriangle size={12} /> Configuração incompleta
              </span>
            ) : (
              <span className="text-xs px-2 py-0.5 rounded-full border border-amber-500/40 bg-amber-500/15 text-amber-300 inline-flex items-center gap-1">
                <AlertTriangle size={12} /> Não configurado
              </span>
            )}
          </div>
          {status.contaKey && (
            <div className="text-sm text-slate-300">
              <span className="text-slate-500">Nome do remetente:</span> {status.contaKey}
            </div>
          )}
          <div className="text-sm text-slate-300">
            <span className="text-slate-500">E-mail conectado:</span> {status.email ?? '—'}
          </div>
          {!conectado && status.contaKey && (
            <p className="text-xs text-red-400">
              As credenciais da conta &quot;{status.contaKey}&quot; não foram encontradas no ambiente.
              Peça para quem administra a infraestrutura configurar GMAIL_USER_{status.contaKey.toUpperCase()}
              {' '}e GMAIL_APP_PASSWORD_{status.contaKey.toUpperCase()}.
            </p>
          )}
          {!status.contaKey && (
            <p className="text-xs text-amber-400">
              Configure um remetente em Configurações antes de iniciar a campanha de prospecção.
            </p>
          )}
        </div>
      )}

      {podeEditar && status !== null && (
        editando ? (
          <div className="space-y-2">
            <label className="text-xs text-slate-400">Chave da conta (provisionada pela equipe de infraestrutura)</label>
            <div className="flex gap-2">
              <input
                className={input}
                value={contaKey}
                onChange={(e) => setContaKey(e.target.value)}
                disabled={salvando}
                placeholder="ex.: PROSPECCAO_TESTEQA"
                spellCheck={false}
              />
              <button onClick={salvar} disabled={salvando || contaKey.trim() === contaKeySalva}
                className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-500 disabled:opacity-40 inline-flex items-center gap-1 shrink-0">
                {salvando ? <Loader2 size={14} className="animate-spin" /> : salvo ? <Check size={14} /> : <Save size={14} />}
                {salvo ? 'Salvo' : 'Salvar'}
              </button>
              {contaKeySalva && (
                <button onClick={() => { setContaKey(contaKeySalva); setEditando(false); setErro(null); }} disabled={salvando}
                  className="px-3 py-2 rounded-lg border border-[var(--border)] text-slate-400 text-sm hover:text-slate-200 shrink-0">
                  Cancelar
                </button>
              )}
            </div>
            <p className="text-xs text-slate-500">
              A chave identifica um par de variáveis já provisionadas no ambiente
              (GMAIL_USER_&lt;CHAVE&gt; / GMAIL_APP_PASSWORD_&lt;CHAVE&gt;). Deixe em branco e salve para desconectar.
            </p>
          </div>
        ) : (
          <button onClick={() => setEditando(true)}
            className="text-xs px-3 py-1.5 rounded-lg border border-[var(--border)] text-slate-400 hover:text-slate-200 hover:border-indigo-500/50">
            Trocar conta
          </button>
        )
      )}

      {erro && <div className="text-xs text-red-400">{erro}</div>}
    </div>
  );
}
