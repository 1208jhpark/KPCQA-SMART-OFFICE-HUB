'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  COMPANY_EMAIL_SUFFIX,
  extractEmailLocalPart,
  resolveCompanyEmail,
} from '@/utils/companyEmail';

export default function LoginPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({ emailLocal: '', password: '' });
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [requesting, setRequesting] = useState(false);

  const fullEmail = resolveCompanyEmail(formData.emailLocal);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = resolveCompanyEmail(formData.emailLocal);
    if (!email) {
      alert(`사내 메일 아이디를 입력해 주세요. (${COMPANY_EMAIL_SUFFIX})`);
      return;
    }

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: formData.password }),
    });

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      if (data.mustReset) {
        router.push('/account/password?forced=1');
      } else {
        router.push('/home');
      }
    } else {
      const err = await res.json();
      alert(err.message || '로그인 실패');
    }
  };

  const handleRequestReset = async () => {
    const email = resolveCompanyEmail(formData.emailLocal);
    if (!email) {
      alert('위에 사내 메일 아이디를 먼저 입력한 뒤 초기화 요청을 해 주세요.');
      return;
    }
    setRequesting(true);
    try {
      const res = await fetch('/api/auth/request-password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || '요청에 실패했습니다.');
        return;
      }
      alert(data.message || '초기화 요청이 접수되었습니다.');
      setShowForgotModal(false);
    } catch {
      alert('통신 오류가 발생했습니다.');
    } finally {
      setRequesting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] font-sans">
      <form onSubmit={handleLogin} className="p-12 bg-white rounded-[3rem] shadow-2xl w-full max-w-md border border-gray-100 animate-in fade-in zoom-in duration-300">
        <div className="text-center mb-10">
        <h1 className="text-4xl font-black text-slate-900 tracking-tighter italic">
   <br /> SMART OFFICE HUB
</h1>
          <p className="text-blue-500 text-[10px] font-black uppercase tracking-[0.3em] mt-2">KPCQA 통합 자산 및 업무 관리 플랫폼</p>
        </div>

        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-400 ml-2 uppercase">Email</label>
            <div className="flex items-stretch overflow-hidden rounded-2xl border border-slate-300 bg-slate-50 focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-400 transition-all">
              <input
                type="text"
                autoComplete="username"
                inputMode="email"
                placeholder="메일 아이디"
                className="min-w-0 flex-1 p-5 bg-transparent outline-none font-bold text-slate-700"
                value={formData.emailLocal}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    emailLocal: extractEmailLocalPart(e.target.value),
                  })
                }
                required
              />
              <span className="shrink-0 flex items-center px-4 bg-slate-200/80 text-sm font-black text-slate-600 border-l border-slate-300 select-none">
                {COMPANY_EMAIL_SUFFIX}
              </span>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-400 ml-2 uppercase">Password</label>
            <input 
              type="password" 
              placeholder="비밀번호" 
              className="w-full p-5 bg-slate-50 border border-slate-300 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-400 font-bold text-slate-700 transition-all" 
              value={formData.password}
              onChange={e => setFormData({...formData, password: e.target.value})} 
              required 
            />
          </div>

          <div className="flex justify-end px-1">
            <button
              type="button"
              onClick={() => setShowForgotModal(true)}
              className="text-[11px] font-black text-slate-400 hover:text-blue-600 underline underline-offset-2 transition-colors"
            >
              비밀번호를 잊으셨나요?
            </button>
          </div>
          
          <button className="w-full py-5 bg-slate-900 text-white rounded-2xl font-black shadow-xl hover:bg-blue-600 transition-all active:scale-95 mt-2">
            로그인
          </button>
        </div>

        <div className="mt-10 pt-6 border-t border-slate-100 text-center space-y-4">
          <p className="text-xs font-bold text-slate-400">
            아직 계정이 없으신가요? 
            <Link href="/signup" className="text-blue-600 underline underline-offset-4 ml-2 hover:text-blue-800">회원가입 신청</Link>
          </p>
        </div>
      </form>

      {showForgotModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4" onClick={() => setShowForgotModal(false)}>
          <div className="bg-white w-full max-w-sm rounded-[2rem] shadow-2xl p-8 border border-slate-100" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-black text-slate-800 mb-3">비밀번호를 잊으셨나요?</h3>
            <p className="text-[12px] font-bold text-slate-600 leading-relaxed mb-5">
              이 시스템은 사내 폐쇄망에서 운영되며,
              <br />
              이메일로 재설정 링크를 보내는 기능은 제공하지 않습니다.
            </p>
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-4">
              <p className="text-[11px] font-black text-amber-800 mb-1">해결 방법</p>
              <p className="text-[11px] font-bold text-amber-700 leading-relaxed">
                시스템 관리자(운영관리자 LV_1)에게
                <br />
                비밀번호 초기화를 요청해 주세요.
                <br />
                관리자가 발급한 임시 비밀번호로 로그인한 뒤
                <br />
                새 비밀번호로 변경할 수 있습니다.
              </p>
            </div>
            {fullEmail ? (
              <p className="text-[11px] font-bold text-slate-500 mb-5 text-center">
                요청 계정: <span className="text-indigo-600 font-black">{fullEmail}</span>
              </p>
            ) : (
              <p className="text-[11px] font-bold text-rose-500 mb-5 text-center">
                로그인 화면에 사내 메일 아이디를 먼저 입력해 주세요.
              </p>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowForgotModal(false)}
                className="flex-1 py-3.5 bg-slate-300 text-slate-800 border border-slate-400 rounded-xl font-black text-sm hover:bg-slate-400 transition-colors shadow-sm"
              >
                취소
              </button>
              <button
                type="button"
                disabled={requesting}
                onClick={handleRequestReset}
                className="flex-1 py-3.5 bg-indigo-600 text-white rounded-xl font-black text-sm hover:bg-indigo-700 transition-colors disabled:opacity-50"
              >
                {requesting ? '요청 중…' : '초기화 요청하기'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
