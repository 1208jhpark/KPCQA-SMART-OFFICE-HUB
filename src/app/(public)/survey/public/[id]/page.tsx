'use client';
  
import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { saveAs } from 'file-saver';
  
interface SurveyOption {
  label: string;
  imageUrl?: string;
  referenceLink?: string;
  goToSectionId?: string;
}
  
interface Question {
  id: string;
  type: string;
  title: string;
  isRequired: boolean;
  options?: SurveyOption[];
  scaleMax?: number;
  templateFileName?: string;
  templateFileData?: string;
  questionImageUrl?: string;
  description?: string;
  referenceLink?: string;
}
  
export default function PublicSurveyResponsePage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
     
  const [surveyMeta, setSurveyMeta] = useState<any>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState(''); // 🚀 비밀번호 상태 추가
  const [isAuthLoading, setIsAuthLoading] = useState(false); // 🚀 인증 애니메이션용
  const [isEmailVerified, setIsEmailVerified] = useState(false);
  const [isIntroConfirmed, setIsIntroConfirmed] = useState(false);
  const [isSubmitCompleted, setIsSubmitCompleted] = useState(false); 
  
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [currentSectionId, setCurrentSectionId] = useState<string | null>(null);
     
  useEffect(() => {
    if (!id) return;
     
    if (typeof window !== 'undefined') {
      const scriptId = 'kakao-postcode-script';
      if (!document.getElementById(scriptId)) {
        const script = document.createElement('script');
        script.id = scriptId;
        script.src = '//t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
        script.async = true;
        document.head.appendChild(script);
      }
    }
     
    const init = async () => {
      try {
        const ts = Date.now();
        const [generalRes, deliveryRes] = await Promise.all([
          fetch(`/api/survey/general?t=${ts}`, { cache: 'no-store' }).then(r => r.ok ? r.json() : []).catch(() => []),
          fetch(`/api/survey/delivery?t=${ts}`, { cache: 'no-store' }).then(r => r.ok ? r.json() : []).catch(() => [])
        ]);
        
        const generalMatch = generalRes.find((s: any) => s.id === id);
        const deliveryMatch = deliveryRes.find((s: any) => s.id === id);
        
        let activeMeta = null;
        if (generalMatch) activeMeta = { ...generalMatch, _domain: 'GENERAL' };
        else if (deliveryMatch) activeMeta = { ...deliveryMatch, _domain: 'DELIVERY' };
        
        if (activeMeta) {
          setSurveyMeta(activeMeta);
          
          if (activeMeta.questions) {
            const parsed = typeof activeMeta.questions === 'string' ? JSON.parse(activeMeta.questions) : activeMeta.questions;
            const safeQuestions = Array.isArray(parsed) ? parsed : [];
            setQuestions(safeQuestions);
            
            if (safeQuestions.length > 0) {
              if (safeQuestions[0].type !== 'SECTION') {
                setCurrentSectionId(null);
              } else {
                const firstSection = safeQuestions.find((q: any) => q.type === 'SECTION');
                if (firstSection) setCurrentSectionId(firstSection.id);
              }
            }
          }
        }
      } catch (e) { 
        console.error("인프라 동기화 에러:", e); 
      } finally { 
        setLoading(false); 
      }
    };
    init();
  }, [id]);
     
  const isDelivery = surveyMeta?._domain === 'DELIVERY';
  
  const openPostcodeEngine = (qId: string) => {
    if (typeof window !== 'undefined' && (window as any).daum?.Postcode) {
      new (window as any).daum.Postcode({
        oncomplete: (data: any) => {
          if (isDelivery) {
            setAnswers(prev => ({ ...prev, [`${qId}_zip`]: data.zonecode, [`${qId}_road`]: data.roadAddress || data.address }));
          } else {
            setAnswers(prev => ({ ...prev, [qId]: { ...(prev[qId] || {}), zipCode: data.zonecode, roadAddress: data.roadAddress || data.address } }));
          }
        }
      }).open();
    } else {
      alert('주소 검색 엔진 로드 중입니다. 잠시 후 시도해 주세요.');
    }
  };
     
  // 🚀 [보안 강화]: 단순히 리스트를 대조하던 방식에서 서버에 비번 정합성을 검증하고 토큰을 받는 구조로 개편
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return alert('올바른 이메일 형식을 입력해 주세요.');
    if (!password.trim()) return alert('비밀번호를 입력해 주세요.');
    
    setIsAuthLoading(true);
    try {
      const endpoint = isDelivery ? '/api/survey/delivery' : '/api/survey/general';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'VERIFY_PASSWORD',
          userEmail: email,
          password: password
        })
      });

      if (res.ok) {
        setIsEmailVerified(true);
      } else {
        const errData = await res.json();
        alert(errData.error || '인증에 실패했습니다. 이메일과 비밀번호를 다시 확인해 주세요.');
      }
    } catch (err) {
      alert('네트워크 통신 오류가 발생했습니다.');
    } finally {
      setIsAuthLoading(false);
    }
  };
     
  const handleInputChange = (qId: string, value: any) => setAnswers(prev => ({ ...prev, [qId]: value }));
     
  const handleCheckboxChange = (qId: string, optionLabel: string, checked: boolean) => {
    const currentAns = answers[qId] || [];
    let nextAns = [...currentAns];
    if (checked) nextAns.push(optionLabel);
    else nextAns = nextAns.filter((val: string) => val !== optionLabel);
    setAnswers(prev => ({ ...prev, [qId]: nextAns }));
  };
     
  const handleUserFileUpload = (qId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        setAnswers(prev => ({ ...prev, [qId]: { fileName: file.name, fileData: evt.target?.result as string } }));
      };
      reader.readAsDataURL(file);
    }
  };
     
  const handleSubmitSurvey = async () => {
    for (const q of questions) {
      if (q.type !== 'SECTION' && q.isRequired) {
        if (q.type === 'SEARCH_ADDRESS' && isDelivery) {
          if (!answers[`${q.id}_zip`] || !answers[`${q.id}_road`] || !answers[`${q.id}_detail`]) {
            return alert(`📍 [ ${q.title} ] 항목의 주소를 완벽히 기입해 주세요.`);
          }
        } else if (!answers[q.id] || (Array.isArray(answers[q.id]) && answers[q.id].length === 0)) {
          return alert(`💡 [ ${q.title} ] 항목은 필수 기입 사항입니다.`);
        }
      }
    }
     
    if (!confirm(isDelivery ? '배송 명세를 최종 접수하시겠습니까?' : '답변서 제출을 완료하시겠습니까?')) return;
     
    try {
      const endpoint = isDelivery ? '/api/survey/delivery' : '/api/survey/general';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'SUBMIT_RESPONSE',
          surveyId: id,
          userEmail: email, // 토큰 기반으로 작동하되 비로그인 fallback 유지용 전송
          answers: answers
        })
      });
      
      if (res.ok) {
        alert(isDelivery ? '🚚 배송 신청이 정상적으로 완료되었습니다.' : '✅ 답변서 제출이 완료되었습니다.');
        setIsSubmitCompleted(true); 
      } else {
        alert('❌ 서버 제출 처리에 실패했습니다. 기한 만료 여부를 확인하세요.');
      }
    } catch (err) {
      alert('❌ 네트워크 오류가 발생했습니다.');
    }
  };
     
  if (loading) return <div className="p-20 text-center font-black text-slate-400 animate-pulse">인프라 로드 중...</div>;
  if (!surveyMeta) return <div className="p-20 text-center font-black text-red-500 text-lg mt-20">존재하지 않거나 이미 마감된 배포 링크입니다.</div>;
     
  if (isSubmitCompleted) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4 font-sans w-full max-w-md mx-auto shadow-2xl border-x text-center">
        <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-xl w-full">
          <div className="text-5xl mb-4">🎉</div>
          <h1 className="text-base font-black text-slate-800 tracking-tight">
            {isDelivery ? '배송 명세 접수 완료' : '설문 응답 제출 완료'}
          </h1>
          <p className="text-[11px] text-slate-400 font-bold mt-3 mb-6 leading-relaxed">
            임직원 계정(<span className="text-indigo-600 font-black">{email}</span>)으로 <br />
            정상적인 원장 등록 처리가 완료되었습니다. <br />
            보안을 위해 본 브라우저 창을 닫아주셔도 좋습니다.
          </p>
          <button onClick={() => { if(typeof window !== 'undefined') window.close(); }} className="w-full py-3.5 bg-slate-900 text-white rounded-xl font-black text-xs transition-all active:scale-95">
            확인 (창 닫기)
          </button>
        </div>
      </div>
    );
  }
     
  if (!isEmailVerified) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans text-xs">
        <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-xl max-w-md w-full text-center space-y-6">
          <div className="text-4xl">{isDelivery ? '📦' : '🔒'}</div>
          <div>
            <h2 className="text-base font-black text-slate-800 tracking-tight">{surveyMeta.title}</h2>
            <p className="text-[10px] text-slate-400 font-bold mt-1.5 leading-relaxed">사내 계정정보를 입력하여 본인 인증 후 <br/> {isDelivery ? '배송 정보 입력을 시작합니다.' : '설문에 참여하실 수 있습니다.'}</p>
          </div>
          <form onSubmit={handleAuthSubmit} className="space-y-4 text-left">
            <div>
              <label className="text-[10px] font-black text-slate-500 mb-1 block">회사 공식 이메일 주소</label>
              <input 
                type="email" required placeholder="username@kpcqa.or.kr" 
                value={email} onChange={e => setEmail(e.target.value)}
                className="w-full p-3.5 border border-slate-200 rounded-xl font-bold text-xs outline-none focus:border-indigo-500 bg-slate-50 focus:bg-white transition-all text-center"
              />
            </div>
            {/* 🚀 비밀번호 입력 구역 신설 */}
            <div>
              <label className="text-[10px] font-black text-slate-500 mb-1 block">비밀번호</label>
              <input 
                type="password" required placeholder="••••••••" 
                value={password} onChange={e => setPassword(e.target.value)}
                className="w-full p-3.5 border border-slate-200 rounded-xl font-bold text-xs outline-none focus:border-indigo-500 bg-slate-50 focus:bg-white transition-all text-center"
              />
            </div>
            <button type="submit" disabled={isAuthLoading} className={`w-full py-3.5 text-white font-black rounded-xl text-xs transition-all shadow-md ${isAuthLoading ? 'bg-slate-400 cursor-not-allowed' : isDelivery ? 'bg-teal-600 hover:bg-teal-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}>
              {isAuthLoading ? '보안 서식 검증 중...' : '인증하고 시작하기 ➔'}
            </button>
          </form>
        </div>
      </div>
    );
  }
  
  if (!isIntroConfirmed) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4 font-sans text-xs max-w-md mx-auto">
        <div className="bg-white p-8 rounded-[2.5rem] shadow-xl w-full border border-slate-200">
          <h2 className={`font-black text-[11px] uppercase tracking-widest mb-2 ${isDelivery ? 'text-teal-600' : 'text-indigo-600'}`}>
            {isDelivery ? '배송 신청 안내문' : '설문 참여 안내문'}
          </h2>
          <h1 className="text-xl font-black text-slate-900 tracking-tight mb-6 leading-snug">{surveyMeta.title}</h1>
          
          <div className="space-y-4 mb-8">
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
              <span className="text-[9px] font-black text-slate-400 uppercase">상세 설명</span>
              <p className="text-xs font-bold text-slate-700 mt-1.5 leading-relaxed whitespace-pre-wrap">
                {surveyMeta.description || '등록된 상세 설명이 없습니다.'}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                <span className="text-[9px] font-black text-slate-400 uppercase">대상 범위</span>
                <p className="text-xs font-black text-slate-800 mt-1 truncate">{surveyMeta.target || '전사'}</p>
              </div>
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                <span className="text-[9px] font-black text-slate-400 uppercase">운영 기간</span>
                <p className="text-[10px] font-black text-slate-800 mt-1 leading-tight">{surveyMeta.startDate}<br/>~ {surveyMeta.endDate}</p>
              </div>
            </div>
          </div>
          
          <button onClick={() => setIsIntroConfirmed(true)} className={`w-full py-4 text-white rounded-xl font-black text-xs shadow-lg transition-colors ${isDelivery ? 'bg-teal-600 hover:bg-teal-700 shadow-teal-200' : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200'}`}>응답 시작하기 →</button>
        </div>
      </div>
    );
  }
     
  const hasSections = questions.some(q => q.type === 'SECTION');
  const sectionsOrder: (string | null)[] = [];
  if (questions.length > 0 && questions[0].type !== 'SECTION') sectionsOrder.push(null);
  questions.filter(q => q.type === 'SECTION').forEach(s => sectionsOrder.push(s.id));
     
  const currentSectionIndex = sectionsOrder.indexOf(currentSectionId);
  const isLastSection = !hasSections || currentSectionIndex === sectionsOrder.length - 1;
     
  const renderedQuestions = questions.filter((q, idx) => {
    if (!hasSections) return true;
    if (q.type === 'SECTION') return q.id === currentSectionId;
    const lastSection = questions.slice(0, idx + 1).reverse().find(item => item.type === 'SECTION');
    return (lastSection ? lastSection.id : null) === currentSectionId;
  });
     
  return (
    <div className="min-h-screen bg-slate-100 font-sans text-slate-900 pb-32 text-[11px]">
      <div className="max-w-[640px] mx-auto pt-12 space-y-4 px-4">
        
        <div className={`text-white p-6 rounded-3xl shadow-lg border ${isDelivery ? 'bg-slate-900 border-teal-900' : 'bg-slate-900 border-slate-800'}`}>
          <span className={`px-2 py-0.5 text-white rounded text-[9px] font-black uppercase tracking-wider ${isDelivery ? 'bg-teal-600' : 'bg-indigo-50'}`}>
            Public {isDelivery ? 'Delivery' : 'Form'}
          </span>
          <h1 className="text-base font-black mt-2">{surveyMeta.title}</h1>
          <p className="text-[10px] text-slate-400 mt-1 font-medium whitespace-pre-wrap">{surveyMeta.description || '안내 사항을 숙지하신 후 응답해 주시기 바랍니다.'}</p>
          <div className="mt-4 pt-3 border-t border-slate-700/50 flex justify-between items-center text-[9px] text-slate-400 font-bold">
            <span>응답 계정: <span className={isDelivery ? 'text-teal-400' : 'text-indigo-400'}>{email}</span></span>
            <span>마감일: {surveyMeta.endDate}</span>
          </div>
        </div>
     
        {renderedQuestions.map((q) => {
          if (q.type === 'SECTION') {
            return (
              <div key={q.id} className={`text-white p-5 rounded-2xl shadow-sm mb-2 ${isDelivery ? 'bg-teal-900 border border-teal-950' : 'bg-indigo-900 border border-indigo-950'}`}>
                <h3 className="text-sm font-black flex items-center gap-1.5">🔖 {q.title}</h3>
                {q.description && <p className={`text-[10px] mt-2 font-medium whitespace-pre-wrap ${isDelivery ? 'text-teal-200' : 'text-indigo-200'}`}>{q.description}</p>}
              </div>
            );
          }
     
          return (
            <div key={q.id} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
              <div>
                <h4 className="font-black text-slate-800 text-xs flex items-center gap-1">
                  {q.title} {q.isRequired && <span className="text-red-500 font-extrabold">*</span>}
                </h4>
                {q.description && <p className="text-[10px] text-slate-400 mt-1 font-bold whitespace-pre-wrap">💡 {q.description}</p>}
                {q.referenceLink && (
                  <a href={q.referenceLink} target="_blank" rel="noopener noreferrer" className={`mt-2 inline-block px-2.5 py-1 rounded text-[9px] font-black border ${isDelivery ? 'bg-teal-50 text-teal-600 border-teal-100 hover:bg-teal-100' : 'bg-blue-50 text-blue-600 border-blue-100 hover:bg-blue-100'}`}>
                    🔗 관련 참고 링크 열기
                  </a>
                )}
              </div>
     
              {q.type === 'CHOICE_SINGLE' && (
                <div className="space-y-2 pt-1">
                  {q.options?.map((opt, oIdx) => (
                    <label key={oIdx} className={`flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl cursor-pointer transition-colors ${isDelivery ? 'hover:bg-teal-50/40' : 'hover:bg-indigo-50/40'}`}>
                      <input type="radio" name={q.id} checked={answers[q.id] === opt.label}
                        onChange={() => {
                          handleInputChange(q.id, opt.label);
                          if (opt.goToSectionId && opt.goToSectionId !== 'SUBMIT') setCurrentSectionId(opt.goToSectionId);
                        }}
                        className={`w-3.5 h-3.5 ${isDelivery ? 'accent-teal-600' : 'accent-indigo-600'}`} 
                      />
                      <div className="flex flex-col flex-1">
                        <span className="font-bold text-slate-700">{opt.label}</span>
                        {opt.referenceLink && <a href={opt.referenceLink} target="_blank" rel="noopener noreferrer" className="text-[9px] text-blue-500 hover:underline mt-0.5" onClick={e => e.stopPropagation()}>🔗 명세 링크</a>}
                        {opt.imageUrl && <img src={opt.imageUrl} className="mt-2 max-h-24 object-contain rounded border bg-white w-fit" />}
                      </div>
                    </label>
                  ))}
                </div>
              )}
     
              {q.type === 'CHOICE_MULTI' && (
                <div className="space-y-2 pt-1">
                  {q.options?.map((opt, oIdx) => (
                    <label key={oIdx} className={`flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl cursor-pointer transition-colors ${isDelivery ? 'hover:bg-teal-50/40' : 'hover:bg-indigo-50/40'}`}>
                      <input type="checkbox" checked={(answers[q.id] || []).includes(opt.label)} onChange={(e) => handleCheckboxChange(q.id, opt.label, e.target.checked)} className={`w-3.5 h-3.5 rounded ${isDelivery ? 'accent-teal-600' : 'accent-indigo-600'}`} />
                      <div className="flex flex-col flex-1">
                        <span className="font-bold text-slate-700">{opt.label}</span>
                        {opt.referenceLink && <a href={opt.referenceLink} target="_blank" rel="noopener noreferrer" className="text-[9px] text-blue-500 hover:underline mt-0.5" onClick={e => e.stopPropagation()}>🔗 관련 링크</a>}
                        {opt.imageUrl && <img src={opt.imageUrl} className="mt-2 max-h-24 object-contain rounded border bg-white w-fit" />}
                      </div>
                    </label>
                  ))}
                </div>
              )}
     
              {q.type === 'TEXT_SHORT' && <input type="text" value={answers[q.id] || ''} onChange={(e) => handleInputChange(q.id, e.target.value)} className={`w-full p-3 border border-slate-200 rounded-xl outline-none font-bold bg-slate-50 focus:bg-white text-xs ${isDelivery ? 'focus:border-teal-500' : 'focus:border-indigo-500'}`} placeholder="답변 내용을 작성해 주세요." />}
              {q.type === 'TEXT_LONG' && <textarea value={answers[q.id] || ''} onChange={(e) => handleInputChange(q.id, e.target.value)} className={`w-full p-3 border border-slate-200 rounded-xl outline-none font-bold bg-slate-50 focus:bg-white text-xs min-h-[100px] ${isDelivery ? 'focus:border-teal-500' : 'focus:border-indigo-500'}`} placeholder="세부 내용을 입력해 주세요." />}
     
              {q.type === 'SCALE' && (
                <div className="flex items-center justify-between bg-slate-50 p-4 border border-slate-200 rounded-xl">
                  <span className="font-black text-slate-400">매우 미흡</span>
                  <div className="flex gap-2">
                    {Array.from({ length: q.scaleMax || 5 }, (_, i) => i + 1).map((n) => (
                      <button key={n} type="button" onClick={() => handleInputChange(q.id, n)} className={`w-8 h-8 rounded-full font-mono font-black border transition-all text-xs ${answers[q.id] === n ? (isDelivery ? 'bg-teal-600 text-white border-teal-600 shadow-md scale-110' : 'bg-indigo-600 text-white border-indigo-600 shadow-md scale-110') : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'}`}>
                        {n}
                      </button>
                    ))}
                  </div>
                  <span className="font-black text-slate-600">매우 우수</span>
                </div>
              )}
     
              {q.type === 'SEARCH_ADDRESS' && (
                <div className="space-y-2 bg-slate-50 p-4 rounded-xl border">
                  <button type="button" onClick={() => openPostcodeEngine(q.id)} className="px-4 py-2 bg-slate-900 text-white font-black rounded-lg hover:bg-slate-800 transition-colors">
                    🔍 주소지 검색 찾기
                  </button>
                  
                  {isDelivery ? (
                    <>
                      {answers[`${q.id}_road`] && (
                        <div className="p-3 bg-white rounded border space-y-1 text-[10px] font-bold text-slate-700">
                          <p>우편번호: <span className="text-teal-600">{answers[`${q.id}_zip`]}</span></p>
                          <p>기본주소: {answers[`${q.id}_road`]}</p>
                        </div>
                      )}
                      <input type="text" placeholder="상세 건물명 및 동/호수 입력" value={answers[`${q.id}_detail`] || ''} onChange={(e) => handleInputChange(`${q.id}_detail`, e.target.value)} className={`w-full p-2.5 border rounded-lg bg-white outline-none font-bold ${isDelivery ? 'focus:border-teal-500' : 'focus:border-indigo-500'}`} />
                    </>
                  ) : (
                    <>
                      {answers[q.id]?.roadAddress && (
                        <div className="p-3 bg-white rounded border space-y-1 text-[10px] font-bold text-slate-700">
                          <p>우편번호: <span className="text-indigo-600">{answers[q.id]?.zipCode}</span></p>
                          <p>기본주소: {answers[q.id]?.roadAddress}</p>
                        </div>
                      )}
                      <input type="text" placeholder="상세 건물명 및 동/호수 입력" value={answers[q.id]?.detailAddress || ''} onChange={(e) => setAnswers(prev => ({...prev, [q.id]: { ...(prev[q.id] || {}), detailAddress: e.target.value }}))} className={`w-full p-2.5 border rounded-lg bg-white outline-none font-bold focus:border-indigo-500`} />
                    </>
                  )}
                </div>
              )}
     
              {q.type === 'CALENDAR' && <input type="date" value={answers[q.id] || ''} onChange={(e) => handleInputChange(q.id, e.target.value)} className={`p-3 border rounded-xl bg-slate-50 font-black text-slate-700 outline-none ${isDelivery ? 'focus:border-teal-500' : 'focus:border-indigo-500'}`} />}
     
              {q.type === 'FILE' && (
                <div className="space-y-3 p-4 bg-slate-50 border border-slate-200 rounded-xl">
                  {q.templateFileName && (
                    <div className={`flex items-center justify-between bg-white p-3 rounded-lg border shadow-sm ${isDelivery ? 'border-teal-100' : 'border-indigo-100'}`}>
                      <div className="flex items-center gap-2"><span className="text-base">📥</span><div><p className="font-black text-slate-700">{q.templateFileName}</p><p className="text-[9px] text-slate-400 font-bold">양식을 다운로드 하세요.</p></div></div>
                      <button type="button" onClick={() => { if (q.templateFileData) fetch(q.templateFileData).then(r => r.blob()).then(blob => saveAs(blob, q.templateFileName!)); }} className={`px-3 py-1.5 rounded font-black border ${isDelivery ? 'bg-teal-50 text-teal-600 border-teal-100 hover:bg-teal-100' : 'bg-indigo-50 text-indigo-600 border-indigo-100 hover:bg-indigo-100'}`}>양식 받기</button>
                    </div>
                  )}
                  <div className="border-2 border-dashed border-slate-200 rounded-xl p-4 bg-white text-center">
                    {answers[q.id]?.fileName ? (
                      <div className="flex items-center justify-between text-left font-bold text-slate-700">
                        <span>📎 첨부됨: {answers[q.id].fileName}</span>
                        <button type="button" onClick={() => handleInputChange(q.id, null)} className="text-red-400 font-black hover:underline">취소</button>
                      </div>
                    ) : (
                      <label className={`cursor-pointer font-black hover:underline ${isDelivery ? 'text-teal-600' : 'text-indigo-600'}`}>
                        ➕ 파일 업로드 하기
                        <input type="file" className="hidden" onChange={(e) => handleUserFileUpload(q.id, e)} accept=".hwp,.pdf,.doc,.docx,.xls,.xlsx" />
                      </label>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
     
        <div className="pt-4 flex justify-between gap-4">
          {hasSections && currentSectionIndex > 0 && (
            <button type="button" onClick={() => setCurrentSectionId(sectionsOrder[currentSectionIndex - 1])} className="px-5 py-3.5 bg-white border border-slate-300 rounded-xl font-black text-slate-600 shadow-sm hover:bg-slate-50 transition-all">◀ 이전 단계</button>
          )}
          
          {!isLastSection ? (
            <button type="button" onClick={() => setCurrentSectionId(sectionsOrder[currentSectionIndex + 1])} className={`flex-1 py-3.5 text-white font-black text-xs rounded-xl shadow-lg transition-all ${isDelivery ? 'bg-teal-600 hover:bg-teal-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}>다음 단계 진행 ▶</button>
          ) : (
            <button type="button" onClick={handleSubmitSurvey} className="flex-1 py-3.5 bg-slate-900 text-white font-black text-xs rounded-xl shadow-lg hover:bg-black transition-all">💾 최종 답변서 제출</button>
          )}
        </div>
      </div>
    </div>
  );
}