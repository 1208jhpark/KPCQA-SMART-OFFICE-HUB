'use client';

import { useState, Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  COMPANY_EMAIL_SUFFIX,
  extractEmailLocalPart,
  resolveCompanyEmail,
} from '@/utils/companyEmail';

const DEFAULT_BRANDING = {
  main_headline: 'KPCQA WISE',
  sub_headline: 'KPCQA 통합업무지원시스템',
};

/** open-redirect 방지: 같은 사이트 상대 경로만 허용 */
function resolveSafeNext(raw: string | null): string | null {
  if (!raw) return null;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    /* keep raw */
  }
  if (!decoded.startsWith('/') || decoded.startsWith('//') || decoded.includes('://')) {
    return null;
  }
  return decoded;
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [formData, setFormData] = useState({ emailLocal: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [branding, setBranding] = useState(DEFAULT_BRANDING);

  const returnNext = resolveSafeNext(searchParams.get('next'));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/public/branding', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setBranding({
          main_headline: String(data.main_headline || '').trim() || DEFAULT_BRANDING.main_headline,
          sub_headline: String(data.sub_headline || '').trim() || DEFAULT_BRANDING.sub_headline,
        });
      } catch {
        /* keep fallback */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
        router.push(returnNext || '/home');
      }
    } else {
      const err = await res.json();
      alert(err.message || '로그인 실패');
    }
  };

  const handleRequestReset = async () => {
    const email = resolveCompanyEmail(formData.emailLocal);
    if (!email) {
      alert('사내 메일 아이디를 입력해 주세요.');
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
          <h1 className="text-4xl font-black text-slate-900 tracking-tighter">
            {branding.main_headline}
          </h1>
          {branding.sub_headline ? (
            <p className="text-blue-500 text-[10px] font-black uppercase tracking-[0.3em] mt-2">
              {branding.sub_headline}
            </p>
          ) : null}
          {returnNext?.startsWith('/survey/public/') && (
            <p className="text-[11px] font-bold text-indigo-600 mt-4 leading-relaxed">
              배포 링크는 Hub 로그인 없이
              <br />
              이메일 + 비밀번호/사번 인증으로 참여합니다.
              <br />
              링크로 다시 접속해 주세요.
            </p>
          )}
        </div>

        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-400 ml-2 uppercase">Email</label>
            <div className="flex items-stretch overflow-hidden rounded-2xl bg-slate-50 focus-within:ring-2 focus-within:ring-blue-500 transition-all">
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
              <span className="shrink-0 flex items-center px-4 bg-slate-50 text-sm font-black text-slate-500 select-none">
                {COMPANY_EMAIL_SUFFIX}
              </span>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-400 ml-2 uppercase">Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder=""
                className="w-full p-5 pr-14 bg-slate-50 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-slate-700 transition-all"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 보기'}
                title={showPassword ? '비밀번호 숨기기' : '비밀번호 보기'}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
              >
                {showPassword ? (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden>
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden>
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                )}
              </button>
            </div>
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
      </form>

      {showForgotModal && (
        <div
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
          onClick={() => setShowForgotModal(false)}
        >
          <div
            className="bg-white w-full max-w-sm rounded-[2rem] shadow-2xl p-8 border border-slate-100"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-black text-slate-800 mb-5">비밀번호를 잊으셨나요?</h3>
            <div className="space-y-1 mb-6">
              <label className="text-[10px] font-black text-slate-400 ml-2 uppercase">Email</label>
              <div className="flex items-stretch overflow-hidden rounded-2xl bg-slate-50 focus-within:ring-2 focus-within:ring-blue-500 transition-all">
                <input
                  type="text"
                  autoComplete="username"
                  inputMode="email"
                  placeholder="메일 아이디"
                  className="min-w-0 flex-1 p-4 bg-transparent outline-none font-bold text-slate-700"
                  value={formData.emailLocal}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      emailLocal: extractEmailLocalPart(e.target.value),
                    })
                  }
                />
                <span className="shrink-0 flex items-center px-3 bg-slate-50 text-sm font-black text-slate-500 select-none">
                  {COMPANY_EMAIL_SUFFIX}
                </span>
              </div>
            </div>
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

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] font-black text-slate-400 animate-pulse text-sm">
          로딩 중…
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
