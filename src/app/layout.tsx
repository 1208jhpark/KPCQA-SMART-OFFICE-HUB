import './globals.css';
import { Inter } from 'next/font/google';

const inter = Inter({ subsets: ['latin'] });

export const metadata = {
  title: 'SMART OFFICE HUB',
  description: 'KPCQA 통합 자산 관리 시스템',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body className={`${inter.className} antialiased`}>
        {/* 루트에는 UI 요소를 두지 않고 children만 렌더링합니다. */}
        {children}
      </body>
    </html>
  );
}