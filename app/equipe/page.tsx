'use client';

import { useState, useEffect } from 'react';
import { Mail, UserPlus, Clock, CheckCircle } from 'lucide-react';

interface Membro {
  id: string;
  email: string;
  created_at: string;
  confirmed_at: string | null;
  last_sign_in_at: string | null;
}

export default function EquipePage() {
  const [membros, setMembros] = useState<Membro[]>([]);
  const [email, setEmail] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [feedback, setFeedback] = useState<{ tipo: 'sucesso' | 'erro'; msg: string } | null>(null);
  const [buscando, setBuscando] = useState(true);

  async function carregarMembros() {
    setBuscando(true);
    try {
      const res = await fetch('/api/equipe/listar');
      const data = await res.json();
      setMembros(data.users || []);
    } catch {
      console.error('Erro ao carregar membros');
    } finally {
      setBuscando(false);
    }
  }

  useEffect(() => { carregarMembros(); }, []);

  async function handleConvidar(e: React.FormEvent) {
    e.preventDefault();
    setCarregando(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/equipe/convidar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ tipo: 'erro', msg: data.erro || 'Erro ao enviar convite' });
      } else {
        setFeedback({ tipo: 'sucesso', msg: `Convite enviado para ${email}` });
        setEmail('');
        await carregarMembros();
      }
    } catch {
      setFeedback({ tipo: 'erro', msg: 'Erro ao enviar convite' });
    } finally {
      setCarregando(false);
    }
  }

  function formatarData(data: string | null) {
    if (!data) return '—';
    return new Date(data).toLocaleDateString('pt-BR');
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Equipe</h1>
        <p className="text-gray-500 text-sm mt-0.5">{membros.length} membros cadastrados</p>
      </div>

      {/* Convidar novo membro */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <UserPlus size={18} />
          Convidar novo membro
        </h2>
        <form onSubmit={handleConvidar} className="flex gap-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@empresa.com"
            required
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            type="submit"
            disabled={carregando}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {carregando ? 'Enviando...' : 'Enviar convite'}
          </button>
        </form>
        {feedback && (
          <p className={`text-sm mt-2 ${feedback.tipo === 'sucesso' ? 'text-green-600' : 'text-red-500'}`}>
            {feedback.tipo === 'sucesso' ? '✓' : '✗'} {feedback.msg}
          </p>
        )}
        <p className="text-xs text-gray-400 mt-2">
          O membro receberá um email com link para definir sua senha e acessar a plataforma.
        </p>
      </div>

      {/* Lista de membros */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Membros da equipe</h2>
        </div>
        {buscando ? (
          <div className="p-8 text-center text-gray-400 text-sm">Carregando...</div>
        ) : membros.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">Nenhum membro cadastrado.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase">Email</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase">Cadastrado em</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase">Último acesso</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {membros.map((m) => (
                <tr key={m.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3 font-medium text-gray-900 flex items-center gap-2">
                    <Mail size={14} className="text-gray-400" />
                    {m.email}
                  </td>
                  <td className="px-5 py-3">
                    {m.confirmed_at ? (
                      <span className="inline-flex items-center gap-1 text-green-700 bg-green-50 px-2 py-0.5 rounded-full text-xs font-medium">
                        <CheckCircle size={12} /> Ativo
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-yellow-700 bg-yellow-50 px-2 py-0.5 rounded-full text-xs font-medium">
                        <Clock size={12} /> Convite pendente
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-gray-500">{formatarData(m.created_at)}</td>
                  <td className="px-5 py-3 text-gray-500">{formatarData(m.last_sign_in_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
