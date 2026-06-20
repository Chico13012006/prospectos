'use client';

import { usePathname } from 'next/navigation';
import { AppProvider } from '@/contexts/AppContext';
import Sidebar from './Sidebar';

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Páginas de autenticação são renderizadas em tela cheia, sem o sidebar
  if (pathname === '/login' || pathname === '/definir-senha') {
    return <>{children}</>;
  }

  return (
    <AppProvider>
      <div className="flex h-screen overflow-hidden bg-gray-50">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </AppProvider>
  );
}
