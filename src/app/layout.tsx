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
        {/* 루트 레이아웃에는 헤더를 넣지 않습니다. 하위 레이아웃에서 담당합니다. */}
        {children}
      </body>
    </html>
  );
}