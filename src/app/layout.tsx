import './globals.css';
import { Inter } from 'next/font/google';

const inter = Inter({ subsets: ['latin'] });

export const metadata = {
  title: 'KPCQA WISE',
  description: 'KPCQA 통합업무지원시스템',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body className={`${inter.className} antialiased`} suppressHydrationWarning>
        {/* 루트 레이아웃에는 헤더를 넣지 않습니다. 하위 레이아웃에서 담당합니다. */}
        {children}
      </body>
    </html>
  );
}