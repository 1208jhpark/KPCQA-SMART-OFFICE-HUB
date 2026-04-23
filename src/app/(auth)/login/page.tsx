'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function LoginPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({ email: '', password: '' });

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData),
    });

    if (res.ok) {
      router.push('/home');
    } else {
      const err = await res.json();
      alert(err.message || '로그인 실패');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] font-sans">
      <form onSubmit={handleLogin} className="p-12 bg-white rounded-[3rem] shadow-2xl w-full max-w-md border border-gray-100 animate-in fade-in zoom-in duration-300">
        <div className="text-center mb-10">
          <h1 className="text-4xl font-black text-slate-900 tracking-tighter italic">SMART HUB</h1>
          <p className="text-blue-500 text-[10px] font-black uppercase tracking-[0.3em] mt-2">Management System v1.8</p>
        </div>

        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-400 ml-2 uppercase">Company Email</label>
            <input 
              type="email" 
              placeholder="사내이메일을 입력하세요" 
              className="w-full p-5 bg-slate-50 rounded-2xl outline-none focus:ring-2 ring-blue-500 font-bold text-slate-700 transition-all" 
              onChange={e => setFormData({...formData, email: e.target.value})} 
              required 
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-400 ml-2 uppercase">Password</label>
            <input 
              type="password" 
              placeholder="비밀번호" 
              className="w-full p-5 bg-slate-50 rounded-2xl outline-none focus:ring-2 ring-blue-500 font-bold text-slate-700 transition-all" 
              onChange={e => setFormData({...formData, password: e.target.value})} 
              required 
            />
          </div>
          
          <button className="w-full py-5 bg-slate-900 text-white rounded-2xl font-black shadow-xl hover:bg-blue-600 transition-all active:scale-95 mt-4">
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
    </div>
  );
}