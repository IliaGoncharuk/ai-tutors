import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'LLM API Playground — AI Challenge Day 01',
  description:
    'Локальная демонстрация запроса к OpenAI Responses API с управлением параметрами генерации.',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
