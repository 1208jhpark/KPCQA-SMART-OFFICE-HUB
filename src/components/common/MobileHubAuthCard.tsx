'use client';

import React, { useState } from 'react';
import {
  COMPANY_EMAIL_SUFFIX,
  extractEmailLocalPart,
  resolveCompanyEmail,
} from '@/utils/companyEmail';
import { writeMobileAccessToken } from '@/lib/auth-cookie';

export type MobileHubAuthUser = { name: string; email: string };

type VerifyMethod = 'password' | 'employee_no';

type Props = {
  title?: string;
  subtitle?: string;
  submitLabel?: string;
  /** indigo(설문) | teal(배달) | emerald(실사) */
  accent?: 'indigo' | 'teal' | 'emerald';
  footer?: React.ReactNode;
  onSuccess: (user: MobileHubAuthUser) => void | Promise<void>;
};

const ACCENT = {
  indigo: {
    eyebrow: 'text-indigo-600',
    tabOn: 'bg-white text-indigo-700 shadow-sm border border-slate-200/80',
    btn: 'bg-indigo-600 hover:bg-indigo-700',
  },
  teal: {
    eyebrow: 'text-teal-600',
    tabOn: 'bg-white text-teal-700 shadow-sm border border-slate-200/80',
    btn: 'bg-teal-600 hover:bg-teal-700',
  },
  emerald: {
    eyebrow: 'text-emerald-700',
    tabOn: 'bg-white text-emerald-700 shadow-sm border border-slate-200/80',
    btn: 'bg-emerald-700 hover:bg-emerald-800',
  },
} as const;

/** 모바일 배포 링크 공통 본인 인증 (이메일 앞자리 + Hub 비번 또는 사번) */
export default function MobileHubAuthCard({
  title = '본인 인증',
  subtitle = '사내 계정으로 본인을 확인한 뒤 진행합니다.',
  submitLabel = '인증하고 계속하기',
  accent = 'indigo',
  footer,
  onSuccess,
}: Props) {
  const tone = ACCENT[accent];
  const [emailLocal, setEmailLocal] = useState('');
  const [method, setMethod] = useState<VerifyMethod>('password');
  const [credential, setCredential] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = resolveCompanyEmail(emailLocal);
    if (!email) {
      alert(`사내 메일 아이디를 입력해 주세요. (${COMPANY_EMAIL_SUFFIX})`);
      return;
    }
    if (!credential.trim()) {
      alert(method === 'password' ? 'Hub 비밀번호를 입력해 주세요.' : '사번을 입력해 주세요.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/mobile-gate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          method,
          credential: credential.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || '정보가 일치하지 않습니다.');
        return;
      }
      if (data.accessToken) writeMobileAccessToken(data.accessToken);
      await onSuccess({
        name: data.user?.name || email,
        email: data.user?.email || email,
      });
    } catch {
      alert('네트워크 오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white p-6 rounded-[2rem] shadow-xl w-full text-center border border-slate-200/80 space-y-4"
    >
      <div>
        <p className={`text-[10px] font-black uppercase tracking-widest ${tone.eyebrow}`}>
          Smart Office Hub
        </p>
        <h1 className="text-base font-black text-slate-800 tracking-tight mt-1">{title}</h1>
        <p className="text-[10px] text-slate-400 font-bold mt-1.5 leading-relaxed">{subtitle}</p>
      </div>

      <div className="text-left space-y-1.5">
        <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
          사내 이메일
        </label>
        <div className="flex items-stretch rounded-xl border border-slate-200 overflow-hidden bg-slate-50">
          <input
            type="text"
            inputMode="email"
            autoComplete="username"
            required
            value={emailLocal}
            onChange={(e) => setEmailLocal(extractEmailLocalPart(e.target.value))}
            className="flex-1 min-w-0 p-3.5 text-xs font-black text-center outline-none bg-transparent"
            placeholder="아이디"
          />
          <span className="shrink-0 px-3 flex items-center text-[11px] font-black text-slate-500 bg-slate-100 border-l border-slate-200">
            {COMPANY_EMAIL_SUFFIX}
          </span>
        </div>
      </div>

      <div className="bg-slate-100/80 p-1 rounded-xl flex gap-1">
        <button
          type="button"
          onClick={() => {
            setMethod('password');
            setCredential('');
          }}
          className={`flex-1 py-2 rounded-lg text-[11px] font-black transition-all ${
            method === 'password' ? tone.tabOn : 'text-slate-500'
          }`}
        >
          Hub 비밀번호
        </button>
        <button
          type="button"
          onClick={() => {
            setMethod('employee_no');
            setCredential('');
          }}
          className={`flex-1 py-2 rounded-lg text-[11px] font-black transition-all ${
            method === 'employee_no' ? tone.tabOn : 'text-slate-500'
          }`}
        >
          사번
        </button>
      </div>

      <div className="text-left space-y-1.5">
        <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
          {method === 'password' ? 'SMART OFFICE HUB 비밀번호' : '사번'}
        </label>
        <input
          type={method === 'password' ? 'password' : 'text'}
          autoComplete={method === 'password' ? 'current-password' : 'off'}
          required
          value={credential}
          onChange={(e) => setCredential(e.target.value)}
          className="w-full p-3.5 border border-slate-200 rounded-xl text-xs font-black text-center outline-none bg-slate-50"
          placeholder={method === 'password' ? '비밀번호' : '사번 숫자'}
        />
      </div>

      {footer}

      <button
        type="submit"
        disabled={submitting}
        className={`w-full py-3.5 text-white rounded-xl font-black text-xs shadow-md transition-all disabled:opacity-60 ${tone.btn}`}
      >
        {submitting ? '인증 중…' : submitLabel}
      </button>
    </form>
  );
}
