'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, CheckCircle } from 'lucide-react';

const NICHOS = [
  'Hotelaria',
  'Óticas',
  'Agronegócio',
  'Indústria',
  'Logística',
  'Saúde',
  'Varejo',
  'Tecnologia',
  'Construção Civil',
  'Educação',
  'Todos os nichos',
];

function avatarUrl(nome: string | null, email: string) {
  const seed = nome || email;
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(seed)}&background=6366f1&color=fff&size=128&bold=true`;
}

export default function MeuPerfilPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [email, setEmail] = useState('');
  const [nome, setNome] = useState('');
  const [nicho, setNicho] = useState('');
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  useEffect(() => {
    fetch('/api/perfil')
      .then(r => r.json())
      .then(data => {
        setEmail(data.email || '');
        if (data.perfil) {
          setNome(data.perfil.nome || '');
          setNicho(data.perfil.nicho || '');
          setAvatarPreview(data.perfil.avatar_url || null);
        }
      })
      .finally(() => setCarregando(false));
  }, []);

  async function handleFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Preview local imediato
    setAvatarPreview(URL.createObjectURL(file));
    setUploading(true);

    const form = new FormData();
    form.append('file', file);

    const res = await fetch('/api/perfil/avatar', { method: 'POST', body: form });
    const data = await res.json();

    if (data.avatar_url) setAvatarPreview(data.avatar_url);
    setUploading(false);
  }

  async function handleSalvar(e: React.FormEvent) {
    e.preventDefault();
    if (!nome.trim()) { setErro('Nome é obrigatório'); return; }
    setSalvando(true);
    setErro('');

    const res = await fetch('/api/perfil', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, nicho, avatar_url: avatarPreview }),
    });

    if (res.ok) {
      router.push('/pipeline');
    } else {
      const data = await res.json();
      setErro(data.erro || 'Erro ao salvar');
      setSalvando(false);
    }
  }

  const fotoExibida = avatarPreview || avatarUrl(nome || null, email);

  if (carregando) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm">Carregando...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-xl font-bold text-gray-900">Configure seu perfil</h1>
          <p className="text-gray-500 text-sm mt-1">Adicione suas informações para continuar</p>
        </div>

        <form onSubmit={handleSalvar} className="space-y-5">
          {/* Foto */}
          <div className="flex flex-col items-center gap-2">
            <div className="relative">
              <img
                src={fotoExibida}
                alt="Avatar"
                className="w-24 h-24 rounded-full object-cover border-4 border-white shadow-md"
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="absolute bottom-0 right-0 w-8 h-8 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full flex items-center justify-center shadow-md transition-colors"
              >
                {uploading ? (
                  <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Camera size={14} />
                )}
              </button>
            </div>
            <p className="text-xs text-gray-400">Clique para adicionar foto</p>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFoto} />
          </div>

          {/* Email (readonly) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email" value={email} disabled
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500 cursor-not-allowed"
            />
          </div>

          {/* Nome */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nome completo *</label>
            <input
              type="text" value={nome} onChange={e => setNome(e.target.value)} required
              placeholder="Seu nome"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Nicho */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nicho / Segmento</label>
            <select
              value={nicho} onChange={e => setNicho(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
            >
              <option value="">Selecione seu segmento</option>
              {NICHOS.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>

          {erro && <p className="text-red-500 text-sm">{erro}</p>}

          <button
            type="submit" disabled={salvando}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
          >
            {salvando ? (
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <CheckCircle size={16} />
            )}
            {salvando ? 'Salvando...' : 'Salvar e acessar plataforma'}
          </button>
        </form>
      </div>
    </div>
  );
}
