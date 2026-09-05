import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Температура — лаборатория Дня 4',
  description: 'Один запрос, три температуры и реальные ответы рядом.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}
