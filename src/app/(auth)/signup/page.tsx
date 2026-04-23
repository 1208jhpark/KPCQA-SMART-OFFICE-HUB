'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function SignupPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({ name: '', email: '', unit_id: '', password: '', confirmPassword: '' });
  const [orgUnits, setOrgUnits] = useState([]);
  const [isAgreed, setIsAgreed] = useState(false);
  const [isTermsModalOpen, setIsTermsModalOpen] = useState(false);
  const [pwdMsg, setPwdMsg] = useState({ text: '', color: '' });

  // 🚀 조직 목록 호출
  useEffect(() => {
    fetch('/api/admin/units?active=true').then(res => res.json()).then(data => setOrgUnits(data));
  }, []);

  // 🚀 비밀번호 일치 확인
  useEffect(() => {
    if (!formData.confirmPassword) return;
    formData.password === formData.confirmPassword 
      ? setPwdMsg({ text: '비밀번호가 일치합니다', color: 'text-green-600' }) 
      : setPwdMsg({ text: '비밀번호가 일치하지 않습니다', color: 'text-red-600' });
  }, [formData.password, formData.confirmPassword]);

  // 🚀 회원가입 처리 (변경안 반영)
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAgreed) return alert('시스템 이용 약관에 동의해야 가입이 가능합니다.');

    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData),
    });

    if (res.ok) {
      const data = await res.json();
      
      // 🔥 [핵심 수정] 서버의 status 값에 따라 안내 문구 분기
      if (data.user?.status === 'Active') {
        alert('🎉 초기 관리자 권한으로 자동 승인되었습니다!\n별도의 대기 없이 즉시 로그인이 가능합니다.');
      } else {
        alert('✅ 가입 신청이 성공적으로 완료되었습니다!\n보안 정책에 따라 관리자 승인 후 로그인이 가능합니다.');
      }
      
      router.push('/login');
    } else {
      const errorData = await res.json();
      alert(errorData.message || '가입 신청 중 오류가 발생했습니다. 관리자에게 문의하세요.');
    }
  };

  return (
    <div className="flex justify-center items-center min-h-screen bg-[#F8FAFC] p-4 font-sans text-slate-900">
      <form onSubmit={handleSubmit} className="w-full max-w-md p-10 bg-white rounded-[3rem] shadow-2xl space-y-6 border border-gray-100 animate-in fade-in duration-500">
        <div className="text-center mb-6">
          <h2 className="text-3xl font-black text-slate-900 tracking-tighter italic uppercase">Create Account</h2>
          <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mt-1 italic">Smart Office Hub Service</p>
        </div>

        <div className="space-y-4">
          <input required className="w-full p-4 bg-slate-50 rounded-2xl font-bold outline-none focus:ring-2 ring-blue-500 transition-all" placeholder="사용자 성명" onChange={e => setFormData({...formData, name: e.target.value})} />
          <input required type="email" className="w-full p-4 bg-slate-50 rounded-2xl font-bold outline-none focus:ring-2 ring-blue-500 transition-all" placeholder="사내이메일 (ID)" onChange={e => setFormData({...formData, email: e.target.value})} />
          
          <select required className="w-full p-4 bg-slate-50 rounded-2xl font-bold outline-none focus:ring-2 ring-blue-500 text-slate-500 transition-all" onChange={e => setFormData({...formData, unit_id: e.target.value})}>
            <option value="">소속 조직 선택</option>
            {orgUnits.map((u: any) => <option key={u.id} value={u.id}>{u.unit_name}</option>)}
          </select>

          <div className="grid grid-cols-2 gap-3">
            <input required type="password" placeholder="비밀번호" className="p-4 bg-slate-50 rounded-2xl font-bold outline-none focus:ring-2 ring-blue-500 transition-all" onChange={e => setFormData({...formData, password: e.target.value})} />
            <input required type="password" placeholder="비밀번호 확인" className="p-4 bg-slate-50 rounded-2xl font-bold outline-none focus:ring-2 ring-blue-500 transition-all" onChange={e => setFormData({...formData, confirmPassword: e.target.value})} />
          </div>
          <p className={`text-[10px] font-black ml-2 ${pwdMsg.color}`}>{pwdMsg.text}</p>
        </div>

        {/* 이용약관 영역 */}
        <div className="bg-blue-50/50 p-5 rounded-2xl border border-blue-100 flex items-center justify-between">
          <label className="flex items-center gap-2 cursor-pointer group">
            <input type="checkbox" checked={isAgreed} onChange={e => setIsAgreed(e.target.checked)} className="w-4 h-4 accent-blue-600 rounded" />
            <span className="text-xs font-black text-slate-700 group-hover:text-blue-600 transition-colors">시스템 이용약관 동의 [필수]</span>
          </label>
          <button 
            type="button" 
            onClick={() => setIsTermsModalOpen(true)} 
            className="text-[10px] font-black text-blue-600 underline underline-offset-2 hover:text-blue-800"
          >
            내용보기
          </button>
        </div>

        <button 
          disabled={!isAgreed} 
          className={`w-full py-5 rounded-2xl text-white font-black shadow-xl transition-all ${isAgreed ? 'bg-slate-900 hover:bg-blue-600 active:scale-95' : 'bg-slate-200 cursor-not-allowed text-slate-400'}`}
        >
          회원가입 신청
        </button>

        <p className="text-center text-xs font-bold text-slate-400">
          이미 계정이 있으신가요? <Link href="/login" className="text-blue-500 underline ml-1 font-black">로그인하기</Link>
        </p>
      </form>

      {/* 이용약관 모달 */}
      {isTermsModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[200] flex items-center justify-center p-6">
          <div className="bg-white w-full max-w-lg rounded-[3rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-8 bg-slate-900 text-white flex justify-between items-center">
              <div>
                <h2 className="text-xl font-black italic tracking-widest uppercase">Terms of Service</h2>
                <p className="text-[10px] text-blue-400 font-bold uppercase tracking-widest mt-1">Smart Office Hub Policy</p>
              </div>
              <button onClick={() => setIsTermsModalOpen(false)} className="text-2xl hover:rotate-90 transition-transform">✕</button>
            </div>
            
            <div className="p-8 max-h-[400px] overflow-y-auto bg-slate-50 text-slate-600 space-y-6 text-sm font-medium leading-relaxed font-sans">
              <section>
                <h4 className="font-black text-slate-900 mb-2">제 1 조 (목적)</h4>
                <p>본 약관은 KPCQA 스마트 오피스 허브 시스템의 이용 조건 및 절차를 규정합니다.</p>
              </section>
              <section>
                <h4 className="font-black text-slate-900 mb-2">제 2 조 (회원 가입 및 승인)</h4>
                <p>1. 모든 가입은 사내 이메일 인증이 필요합니다.<br/>2. 초기 가입 3인은 자동 승인되나, 이후 가입자는 관리자 승인이 필수입니다.</p>
              </section>
              <section>
                <h4 className="font-black text-slate-900 mb-2">제 3 조 (보안 및 책임)</h4>
                <p>사용자는 시스템 내 데이터를 업무 외 목적으로 유출해서는 안 되며, 계정 공유를 엄격히 금지합니다.</p>
              </section>
            </div>

            <div className="p-8 bg-white border-t flex flex-col gap-3">
              <button 
                onClick={() => { setIsAgreed(true); setIsTermsModalOpen(false); }}
                className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black shadow-lg hover:bg-slate-900 transition-all"
              >
                약관에 동의하고 닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}