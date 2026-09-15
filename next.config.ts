import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // O envio de proposta ao cliente gera o PDF no servidor lendo a imagem-base e
  // os thumbnails de public/proposta (lib/propostas/pdfServidor.ts). public/
  // não entra no trace das funções por padrão; sem isto a rota falha na Vercel.
  outputFileTracingIncludes: {
    '/api/propostas/**': ['./public/proposta/**/*'],
  },
};

export default nextConfig;
