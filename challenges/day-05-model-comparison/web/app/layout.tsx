import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Три модели — лаборатория Дня 5',
  description: 'Один запрос, три модели: сравнение качества, времени, токенов и стоимости.',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}
