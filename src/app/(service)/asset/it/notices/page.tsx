import React from 'react';
// 🚀 파일명 및 컴포넌트명을 회원님의 네이밍 원칙(NoticeModule)에 완벽하게 맞춤!
import NoticeModule from '@/components/asset/it/NoticeModule';

export const metadata = {
  title: 'IT 실사 공지 설정 | SMART OFFICE HUB',
};

export default function NoticePage() {
  return (
    <div className="w-full h-full animate-fade-in">
      <NoticeModule />
    </div>
  );
}