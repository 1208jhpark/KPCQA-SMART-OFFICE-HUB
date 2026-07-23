'use client';

import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

function ChangePasswordForm() {
  const searchParams = useSearchParams();
  const forced = searchParams.get('forced') === '1';

  const [form, setForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);

    if (form.newPassword !== form.confirmPassword) {
      setMsg({ text: '새 비밀번호가 일치하지 않습니다.', ok: false });
      return;
    }
    if (form.newPassword.length < 8) {
      setMsg({ text: '새 비밀번호는 8자 이상이어야 합니다.', ok: false });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ text: data.message || data.error || '변경에 실패했습니다.', ok: false });
        return;
      }
      alert('비밀번호가 변경되었습니다.');
      // layout의 오래된 must_reset_password 상태 때문에 router.push만으로는 다시 튕김 → 전체 새로고침
      window.location.href = '/home';
      return;
    } catch {
      setMsg({ text: '통신 오류가 발생했습니다.', ok: false });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-full flex items-start justify-center p-8 font-sans">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md bg-white rounded-[2.5rem] shadow-xl border border-slate-100 p-10 space-y-6"
      >
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">비밀번호 변경</h1>
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">
            Account Security
          </p>
        </div>

        {forced && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-center">
            <p className="text-[12px] font-black text-amber-800">임시 비밀번호로 로그인하셨습니다</p>
            <p className="text-[11px] font-bold text-amber-700 mt-1 leading-relaxed">
              보안을 위해 새 비밀번호로 변경한 뒤에만
              <br />
              다른 메뉴를 이용할 수 있습니다.
            </p>
          </div>
        )}

        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-400 ml-1 uppercase">
              현재 비밀번호
            </label>
            <input
              type="password"
              required
              autoComplete="current-password"
              className="w-full p-4 bg-slate-50 rounded-2xl font-bold outline-none focus:ring-2 ring-blue-500 transition-all"
              placeholder={forced ? '관리자에게 받은 임시 비밀번호' : '현재 비밀번호'}
              value={form.currentPassword}
              onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-400 ml-1 uppercase">
              새 비밀번호 (8자 이상)
            </label>
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className="w-full p-4 bg-slate-50 rounded-2xl font-bold outline-none focus:ring-2 ring-blue-500 transition-all"
              placeholder="새 비밀번호"
              value={form.newPassword}
              onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-400 ml-1 uppercase">
              새 비밀번호 확인
            </label>
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className="w-full p-4 bg-slate-50 rounded-2xl font-bold outline-none focus:ring-2 ring-blue-500 transition-all"
              placeholder="새 비밀번호 확인"
              value={form.confirmPassword}
              onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
            />
          </div>
        </div>

        {msg && (
          <p className={`text-[11px] font-black text-center ${msg.ok ? 'text-green-600' : 'text-rose-600'}`}>
            {msg.text}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black shadow-lg hover:bg-blue-600 transition-all active:scale-95 disabled:opacity-50"
        >
          {submitting ? '변경 중…' : '비밀번호 변경'}
        </button>

        {!forced && (
          <p className="text-center text-xs font-bold text-slate-400">
            <Link href="/home" className="text-blue-600 underline underline-offset-2 hover:text-blue-800">
              홈으로 돌아가기
            </Link>
          </p>
        )}
      </form>
    </div>
  );
}

export default function AccountPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="p-20 text-center font-black text-slate-400 animate-pulse">로딩 중…</div>
      }
    >
      <ChangePasswordForm />
    </Suspense>
  );
}
