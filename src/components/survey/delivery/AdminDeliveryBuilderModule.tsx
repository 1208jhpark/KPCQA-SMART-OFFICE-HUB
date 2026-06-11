'use client';
  
import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link'; 
import { saveAs } from 'file-saver';
  
type QuestionType = 'CHOICE_SINGLE' | 'CHOICE_MULTI' | 'TEXT_SHORT' | 'TEXT_LONG' | 'SCALE' | 'FILE' | 'SEARCH_ADDRESS' | 'CALENDAR' | 'SECTION';
  
interface SurveyOption {
  label: string;
  imageUrl?: string;
  referenceLink?: string; 
  goToSectionId?: string; // 🚀 세부 옵션용 섹션 이동 ID
}
     
interface Question {
  id: string;
  type: QuestionType;
  title: string;
  isRequired: boolean;
  options?: SurveyOption[]; 
  scaleMax?: number;  
  templateFileName?: string; 
  templateFileData?: string; 
  questionImageUrl?: string; 
  dummyDateValue?: string;
  zipCode?: string;
  roadAddress?: string;
  detailAddress?: string;
  description?: string;
  referenceLink?: string;
  goToSectionId?: string; // 🚀 모든 문항/섹션용 다음 이동 ID
}
  
export default function AdminDeliveryBuilderModule() {
  const [surveyId, setSurveyId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);
  
  useEffect(() => {
    // 🔥 카카오 주소 API 동적 인젝션
    if (typeof window !== 'undefined') {
      const scriptId = 'kakao-postcode-script';
      if (!document.getElementById(scriptId)) {
        const script = document.createElement('script');
        script.id = scriptId;
        script.src = '//t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
        script.async = true;
        document.head.appendChild(script);
      }
     
      const params = new URLSearchParams(window.location.search);
      const id = params.get('id');
      setSurveyId(id);
  
      if (id) {
        const storedData = localStorage.getItem(`delivery_builder_${id}`);
        if (storedData) {
          try {
            const parsed = JSON.parse(storedData);
            const migratedData = parsed.map((q: any) => ({
              ...q,
              options: q.options?.map((opt: any) => 
                typeof opt === 'string' ? { label: opt, imageUrl: '', referenceLink: '', goToSectionId: '' } : opt
              )
            }));
            setQuestions(migratedData);
          } catch (e) {
            console.error(e);
          }
        }
      }
    }
  }, []);
  
  const handleSort = () => {
    if (dragItem.current === null || dragOverItem.current === null) return;
    const _questions = [...questions];
    const draggedItemContent = _questions.splice(dragItem.current, 1)[0];
    _questions.splice(dragOverItem.current, 0, draggedItemContent);
    dragItem.current = null;
    dragOverItem.current = null;
    setQuestions(_questions);
  };
  
  const openPostcodeEngine = (qId: string) => {
    if (typeof window !== 'undefined' && (window as any).daum?.Postcode) {
      new (window as any).daum.Postcode({
        oncomplete: (data: any) => {
          setQuestions(prev => prev.map(q => q.id === qId ? {
            ...q,
            zipCode: data.zonecode,
            roadAddress: data.roadAddress || data.address
          } : q));
        }
      }).open();
    } else {
      alert('주소 검색 엔진이 아직 로드 중입니다. 잠시 후 다시 시도해 주세요.');
    }
  };
  
  // 🚀 [버그 수정 완료]: QuotaExceededError 용량 초과 방어 로직 탑재
  const handleSaveSurvey = () => {
    if (questions.length === 0) return alert('최소 1개 이상의 문항을 추가해주세요.');
    if (!surveyId) return alert('공고 ID가 유효하지 않습니다. 현황판에서 다시 진입해주세요.');

    try {
      localStorage.setItem(`delivery_builder_${surveyId}`, JSON.stringify(questions));
      alert('✅ 배달 신청 양식 문항이 성공적으로 저장되었습니다.\n통합 공고 현황판 화면에서 배포를 확인하실 수 있습니다.');
    } catch (error: any) {
      if (error.name === 'QuotaExceededError' || error.code === 22) {
        alert('❌ 저장 용량 초과 에러 (QuotaExceededError)\n\n원인: 첨부하신 이미지나 양식 파일의 용량이 너무 커서 브라우저 임시 저장 한도(약 5MB)를 초과했습니다.\n해결: 이미지를 지우거나 용량이 작은 이미지로 교체한 후 다시 저장해 주세요. (추후 DB 연동 시 자동 해결됩니다.)');
      } else {
        alert('❌ 데이터를 저장하는 중 알 수 없는 오류가 발생했습니다.');
      }
    }
  };
  
  const addQuestion = (type: QuestionType) => {
    let defaultTitle = '';
    if (type === 'TEXT_SHORT') defaultTitle = '수령인 성명을 입력해 주세요.';
    if (type === 'TEXT_LONG') defaultTitle = '배송 시 특이사항이나 메모를 기재해 주세요.';
    if (type === 'SEARCH_ADDRESS') defaultTitle = '물품을 수령할 상세 배송지를 입력해 주세요.';
    if (type === 'CALENDAR') defaultTitle = '희망하시는 배송 요청일을 선택해 주세요.';
    if (type === 'SECTION') defaultTitle = '배송 관련 새로운 단락';
     
    setQuestions(prev => [...prev, { 
      id: `Q_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`, type, title: defaultTitle, isRequired: type !== 'SECTION', 
      options: type.includes('CHOICE') ? [{ label: '옵션 1', imageUrl: '', referenceLink: '', goToSectionId: '' }] : undefined, 
      scaleMax: type === 'SCALE' ? 5 : undefined,
      questionImageUrl: '',
      dummyDateValue: type === 'CALENDAR' ? new Date().toISOString().split('T')[0] : undefined,
      zipCode: type === 'SEARCH_ADDRESS' ? '' : undefined,
      roadAddress: type === 'SEARCH_ADDRESS' ? '' : undefined,
      detailAddress: type === 'SEARCH_ADDRESS' ? '' : undefined,
      description: '', referenceLink: '', goToSectionId: ''
    }]);
  };
  
  // 🚀 [버그 수정 완료]: 함수형 업데이트(prev => ...) 적용으로 파일 삭제 무시 현상 해결
  const updateQuestion = (id: string, field: keyof Question, value: any) => {
    setQuestions(prev => prev.map(q => q.id === id ? { ...q, [field]: value } : q));
  };
  
  const deleteQuestion = (id: string) => {
    setQuestions(prev => prev.filter(q => q.id !== id));
  };
  
  const copyQuestion = (q: Question) => {
    setQuestions(prev => {
      const copy = { ...q, id: `Q_${Date.now()}_${Math.random().toString(36).substr(2, 4)}` };
      const index = prev.findIndex(item => item.id === q.id);
      const next = [...prev];
      next.splice(index + 1, 0, copy);
      return next;
    });
  };
  
  const updateOption = (qId: string, optIndex: number, field: keyof SurveyOption, value: string) => {
    setQuestions(prev => prev.map(q => {
      if (q.id === qId && q.options) {
        const newOptions = [...q.options];
        newOptions[optIndex] = { ...newOptions[optIndex], [field]: value };
        return { ...q, options: newOptions };
      }
      return q;
    }));
  };
  
  const addOption = (qId: string) => {
    setQuestions(prev => prev.map(q => q.id === qId && q.options ? { ...q, options: [...q.options, { label: `옵션 ${q.options.length + 1}`, imageUrl: '', referenceLink: '', goToSectionId: '' }] } : q));
  };
  
  const removeOption = (qId: string, optIndex: number) => {
    setQuestions(prev => prev.map(q => q.id === qId && q.options ? { ...q, options: q.options.filter((_, idx) => idx !== optIndex) } : q));
  };
  
  const handleQuestionImage = (qId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (evt) => updateQuestion(qId, 'questionImageUrl', evt.target?.result as string);
      reader.readAsDataURL(file);
    }
  };
  
  const handleOptionImage = (qId: string, optIndex: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (evt) => updateOption(qId, optIndex, 'imageUrl', evt.target?.result as string);
      reader.readAsDataURL(file);
    }
  };
  
  const handleFileUpload = (qId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        setQuestions(prev => prev.map(q => q.id === qId ? { 
          ...q, 
          templateFileName: file.name, 
          templateFileData: evt.target?.result as string 
        } : q));
      };
      reader.readAsDataURL(file);
    }
  };
     
  const formatDeliveryDate = (dateStr: string) => {
    if (!dateStr) return '날짜를 지정해 주세요.';
    const dayNames = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
    const dateObj = new Date(dateStr);
    if (isNaN(dateObj.getTime())) return dateStr;
     
    const yyyy = dateObj.getFullYear();
    const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
    const dd = String(dateObj.getDate()).padStart(2, '0');
    const dayOfWeek = dayNames[dateObj.getDay()];
     
    return `${yyyy}년 ${mm}월 ${dd}일 (${dayOfWeek})`;
  };

  const availableSections = questions.filter(q => q.type === 'SECTION');
  
  return (
    <div className="min-h-screen bg-slate-100 font-sans text-slate-900 pb-32 animate-fade-in relative text-[11px]">
      <div className="sticky top-0 z-50 bg-white border-b border-slate-200 px-8 py-4 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-4">
          <Link href="/survey/delivery/admin/active-surveys" className="px-3 py-2 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors font-black text-[11px] text-slate-600">
            ⬅️ 통합 공고 현황판으로 돌아가기
          </Link>
          <div className="h-6 w-px bg-slate-200 mx-2"></div>
          <div>
            <h1 className="text-lg font-black text-slate-800">🛠️ 배달 신청 문항 생성기 (Delivery Builder)</h1>
            <p className="text-[10px] text-slate-400 font-bold mt-0.5">물품 배송에 특화된 서식 인프라 필드 및 사은품 옵션을 캔버스에 결합합니다.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { if(confirm('모든 문항을 지우시겠습니까?')) setQuestions([]); }} className="px-4 py-2.5 bg-slate-100 rounded-xl text-xs font-black text-slate-500 hover:bg-slate-200 transition-all mr-2">초기화</button>
          <button onClick={handleSaveSurvey} className="px-6 py-2.5 bg-teal-600 rounded-xl text-[11px] font-black text-white shadow-lg hover:bg-teal-700 transition-all">
            💾 배달 양식 문항 저장
          </button>
        </div>
      </div>
  
      <div className="max-w-[800px] mx-auto mt-8 space-y-6">
        {questions.map((q, index) => (
          <div key={q.id} draggable onDragStart={() => (dragItem.current = index)} onDragEnter={() => (dragOverItem.current = index)} onDragEnd={handleSort} onDragOver={(e) => e.preventDefault()}
               className={`bg-white p-6 rounded-3xl border shadow-sm relative group focus-within:ring-2 focus-within:ring-teal-500 transition-all ${q.type === 'SECTION' ? 'border-l-8 border-l-teal-600 border-slate-200 bg-teal-50/10' : 'border-slate-200'}`}>
            
            {/* 🚀 드래그 핸들 */}
            <div className="absolute top-1.5 left-1/2 -translate-x-1/2 cursor-grab text-slate-300 hover:text-teal-500 font-bold select-none opacity-0 group-hover:opacity-100 transition-opacity text-xs tracking-widest">
              ⠿ Drag & Drop Move ⠿
            </div>
            
            <div className="flex flex-wrap md:flex-nowrap justify-between items-start gap-4 mb-4 mt-2">
              <div className="flex-1 flex gap-3 w-full">
                <span className={`text-lg font-black mt-1 ${q.type === 'SECTION' ? 'text-teal-600' : 'text-slate-300'}`}>
                  {q.type === 'SECTION' ? '🔖' : `${index + 1}.`}
                </span>
                <div className="w-full flex flex-col gap-1">
                  <input 
                    type="text" 
                    value={q.title}
                    onChange={(e) => updateQuestion(q.id, 'title', e.target.value)}
                    className={`w-full bg-slate-50 p-3.5 rounded-xl border border-transparent focus:border-teal-300 focus:bg-white outline-none font-bold ${q.type === 'SECTION' ? 'text-sm text-teal-700 bg-teal-50/50' : 'text-[13px]'}`}
                    placeholder={q.type === 'SECTION' ? "배송 관련 단락 제목을 명시하세요" : "신청자에게 보여질 문항 가이드 타이틀을 입력하세요"}
                  />
                  {!['SECTION', 'SCALE', 'FILE', 'SEARCH_ADDRESS', 'CALENDAR'].includes(q.type) && (
                    <div className="mt-1">
                      <div className="flex items-center gap-3">
                        <label className="cursor-pointer px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-[10px] font-black text-slate-500 transition-colors">
                          {q.questionImageUrl ? '📷 이미지 변경' : '📷 이미지 추가'}
                          <input type="file" className="hidden" accept="image/*" onChange={(e) => handleQuestionImage(q.id, e)} />
                        </label>
                        {q.questionImageUrl && (
                          <button onClick={() => updateQuestion(q.id, 'questionImageUrl', '')} className="text-[10px] text-red-400 font-bold hover:underline">
                            이미지 삭제
                          </button>
                        )}
                      </div>
                      {q.questionImageUrl && (
                        <img src={q.questionImageUrl} alt="Question" className="mt-2 max-h-40 rounded-xl border border-slate-200 object-contain" />
                      )}
                    </div>
                  )}
                </div>
              </div>
              <select 
                value={q.type}
                onChange={(e) => updateQuestion(q.id, 'type', e.target.value as QuestionType)}
                className="w-full md:w-48 p-3.5 bg-white border border-slate-200 rounded-xl text-[11px] font-black text-slate-600 outline-none focus:border-teal-500 cursor-pointer shadow-sm"
              >
                <option value="CHOICE_SINGLE">⭕ 단일 선택 (사은품 등)</option>
                <option value="CHOICE_MULTI">☑️ 다중 선택 (복수선택)</option>
                <option value="TEXT_SHORT">✏️ 단답형 (이름/연락처)</option>
                <option value="TEXT_LONG">📝 장문형 (기타 특이사항)</option>
                <option value="SEARCH_ADDRESS">📍 검색형 상세배송지 (우편번호)</option>
                <option value="CALENDAR">📅 배송요청일 (달력)</option>
                <option value="SCALE">⭐ 만족도 평가</option>
                <option value="FILE">📂 서식/도서대장 파일첨부</option>
                <option value="SECTION">🔖 배송 섹션 분할 단락</option>
              </select>
            </div>
  
            <div className="pl-8 pt-2">
              {/* 🚀 모든 문항 타입(섹션 제외)에 부가설명/외부링크 동일 적용 */}
              {q.type !== 'SECTION' && (
                <div className="mb-6 space-y-3 p-4 bg-teal-50/50 border border-teal-100 rounded-xl">
                  <div>
                    <label className="text-[10px] font-black text-teal-800 mb-1 block">💡 배송 가이드라인 / 안내 사항 (선택)</label>
                    <textarea
                      value={q.description || ''}
                      onChange={(e) => updateQuestion(q.id, 'description', e.target.value)}
                      className="w-full p-2.5 border border-teal-200 rounded-lg text-xs font-bold outline-none focus:border-teal-400 min-h-[60px]"
                      placeholder="신청자에게 안내할 상세 배송 정책이나 유의사항을 기재해주세요."
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-teal-800 mb-1 block">🔗 외부 참조 링크 URL (사은품 이미지 등)</label>
                    <input
                      type="text"
                      value={q.referenceLink || ''}
                      onChange={(e) => updateQuestion(q.id, 'referenceLink', e.target.value)}
                      className="w-full p-2.5 border border-teal-200 rounded-lg text-xs font-bold outline-none focus:border-teal-400 mb-2"
                      placeholder="https://... (카탈로그, 디자인 시안 등 외부 URL 입력)"
                    />
                    {q.referenceLink && (
                      <div className="flex items-center gap-2 p-2.5 bg-white border border-slate-200 rounded-lg shadow-sm w-fit">
                        <span className="text-[10px] font-black text-slate-500">사용자 화면 노출 미리보기:</span>
                        <a href={q.referenceLink} target="_blank" rel="noopener noreferrer" className="px-3 py-1 bg-blue-50 text-blue-600 rounded text-[10px] font-black hover:bg-blue-100 transition-colors border border-blue-200">
                          🔗 첨부된 참조 링크 열기
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              )}
     
              {(q.type === 'CHOICE_SINGLE' || q.type === 'CHOICE_MULTI') && (
                <div className="space-y-3">
                  {q.options?.map((opt, oIdx) => (
                    <div key={oIdx} className="flex flex-col gap-2 p-3 bg-slate-50 border border-slate-200 rounded-xl group/opt">
                      <div className="flex items-center gap-3">
                        <span className="text-slate-300 text-lg">{q.type === 'CHOICE_SINGLE' ? '○' : '□'}</span>
                        <input type="text" value={opt.label} onChange={(e) => updateOption(q.id, oIdx, 'label', e.target.value)} className="flex-1 border-b border-transparent hover:border-slate-200 focus:border-teal-500 outline-none py-1.5 text-xs text-slate-700 font-bold transition-all bg-transparent" />
                        
                        <input type="text" value={opt.referenceLink || ''} onChange={(e) => updateOption(q.id, oIdx, 'referenceLink', e.target.value)} className="w-40 px-2 py-1 bg-white border border-slate-200 rounded text-[10px] font-medium outline-none" placeholder="🔗 외부링크 URL" />

                        <label className="cursor-pointer flex items-center justify-center px-3 py-1.5 border border-slate-300 rounded hover:border-teal-400 bg-white text-[10px] font-black text-slate-600 shrink-0 transition-colors">
                          {opt.imageUrl ? '이미지 변경' : '이미지 추가'}
                          <input type="file" className="hidden" accept="image/*" onChange={(e) => handleOptionImage(q.id, oIdx, e)} />
                        </label>
                        {opt.imageUrl && (
                          <button onClick={() => updateOption(q.id, oIdx, 'imageUrl', '')} className="text-[10px] text-red-400 font-black shrink-0">삭제</button>
                        )}
                        {q.options!.length > 1 && <button onClick={() => removeOption(q.id, oIdx)} className="text-slate-300 hover:text-red-500 px-2 transition-opacity font-black">✕</button>}
                      </div>

                      {opt.imageUrl && <div className="ml-8 mt-1 relative w-fit"><img src={opt.imageUrl} className="h-16 rounded border object-cover" /></div>}

                      {/* 🚀 옵션별 섹션 이동 분기 추가 */}
                      {availableSections.length > 0 && (
                        <div className="ml-8 flex items-center gap-2 border-t border-slate-200/60 pt-2 mt-1">
                          <span className="text-[10px] text-slate-400 font-bold">↳ 이 타겟 선택 시:</span>
                          <select value={opt.goToSectionId || ''} onChange={(e) => updateOption(q.id, oIdx, 'goToSectionId', e.target.value)} className="p-1 border bg-white rounded text-[10px] outline-none text-teal-600 font-bold">
                            <option value="">다음 문항으로 계속 진행 (기본)</option>
                            <option value="SUBMIT">🏁 이대로 배송지 제출 및 종료</option>
                            {availableSections.map(s => <option key={s.id} value={s.id}>➔ 섹션: {s.title || '제목 없음'} (으)로 점프</option>)}
                          </select>
                        </div>
                      )}
                    </div>
                  ))}
                  <div className="flex items-center gap-3 pt-2">
                    <button onClick={() => addOption(q.id)} className="text-[11px] font-black text-blue-500 hover:underline px-2 py-1 hover:bg-blue-50 rounded transition-all">배송 옵션 추가하기</button>
                  </div>
                </div>
              )}
  
              {(q.type === 'TEXT_SHORT' || q.type === 'TEXT_LONG') && (
                <div className={`border-b-2 border-dashed border-slate-200 text-slate-400 text-xs py-2 font-bold w-1/2 ${q.type === 'TEXT_LONG' ? 'w-full pb-6' : ''}`}>
                  {q.type === 'TEXT_SHORT' ? '단답형 기재란' : '장문형 세부 기재란'}
                </div>
              )}
     
              {q.type === 'SEARCH_ADDRESS' && (
                <div className="space-y-2.5 max-w-xl bg-slate-50 p-5 border border-slate-200 rounded-2xl animate-fade-in">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 bg-white border border-slate-300 rounded-xl px-3 py-1.5 shadow-sm">
                      <span className="font-black text-slate-500 text-[10px] whitespace-nowrap">우편번호</span>
                      <input type="text" value={q.zipCode || ''} placeholder="자동 조회" className="w-20 text-center font-black text-teal-600 text-xs outline-none bg-transparent" readOnly />
                    </div>
                    <button type="button" onClick={() => openPostcodeEngine(q.id)} className="px-4 py-2 bg-slate-900 text-white rounded-xl text-[10px] font-black hover:bg-slate-800 shadow-md transition-all active:scale-95">
                      🔍 주소지 검색
                    </button>
                  </div>
                  <div className="flex items-center gap-2 bg-white border border-slate-300 rounded-xl px-3 py-2 shadow-sm">
                    <span className="font-black text-slate-400 text-[10px] whitespace-nowrap">기본주소</span>
                    <input type="text" value={q.roadAddress || ''} placeholder="주소지 검색 버튼을 클릭하여 입력하세요" className="w-full text-xs font-bold text-slate-700 outline-none bg-transparent" readOnly />
                  </div>
                  <div className="flex items-center gap-2 bg-white border border-teal-400 rounded-xl px-3 py-2 shadow-sm focus-within:ring-2 focus-within:ring-teal-200 transition-all">
                    <span className="font-black text-teal-600 whitespace-nowrap text-[10px]">상세주소</span>
                    <input type="text" value={q.detailAddress || ''} onChange={(e) => updateQuestion(q.id, 'detailAddress', e.target.value)} placeholder="동, 호수 및 상세 건물명 입력란" className="w-full text-xs font-bold text-slate-800 outline-none bg-transparent" />
                  </div>
                </div>
              )}
     
              {q.type === 'CALENDAR' && (
                <div className="space-y-3 bg-slate-50 p-4 border border-slate-200 rounded-2xl max-w-md animate-fade-in">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-black text-slate-600">날짜 지정:</span>
                    <input type="date" value={q.dummyDateValue || ''} onChange={(e) => updateQuestion(q.id, 'dummyDateValue', e.target.value)} className="p-2 border border-slate-300 rounded-xl bg-white text-xs font-black outline-none focus:border-teal-500 text-slate-700" />
                  </div>
                  <div className="p-2.5 bg-white border border-teal-100 rounded-xl flex items-center gap-2">
                    <span className="text-teal-500 font-bold text-xs">🎯</span>
                    <div className="text-[11px] font-black text-slate-800">
                      실제 임직원단 표출 규격: <span className="text-teal-600 underline font-extrabold">{formatDeliveryDate(q.dummyDateValue || '')}</span>
                    </div>
                  </div>
                </div>
              )}
  
              {q.type === 'SCALE' && (
                <div className="flex items-center gap-4 bg-slate-50 p-4 rounded-xl w-fit border border-slate-100">
                  <span className="text-xs font-black text-slate-500">1점부터</span>
                  <select value={q.scaleMax} onChange={(e) => updateQuestion(q.id, 'scaleMax', Number(e.target.value))} className="p-2 border border-slate-200 rounded-lg text-xs font-black outline-none bg-white shadow-sm cursor-pointer">
                    {[3, 5, 7, 10].map(n => <option key={n} value={n}>{n}점</option>)}
                  </select>
                  <span className="text-xs font-black text-slate-500">까지의 범위 지정</span>
                </div>
              )}
              
              {/* 🚀 파일 삭제 버그 픽스 로직 */}
              {q.type === 'FILE' && (
                <div className="mt-2 p-5 border-2 border-dashed border-teal-200 rounded-2xl flex flex-col items-start gap-3 bg-teal-50/50">
                  <div className="flex items-center gap-2"><span className="text-xl">📥</span><div><p className="text-[11px] font-black text-teal-800">배달 관련 빈 서식 파일 양식 첨부 (선택사항)</p><p className="text-[9px] text-slate-500 font-bold mt-0.5">신청자가 기재 후 다시 동봉해야 할 안내서 양식이 있다면 등록해주세요.</p></div></div>
                  {q.templateFileName ? (
                     <div className="flex items-center gap-3 bg-white px-4 py-2 border border-teal-100 rounded-xl shadow-sm w-full max-w-md">
                        <span className="text-lg">📄</span><span className="flex-1 text-[11px] font-bold text-slate-700 truncate">{q.templateFileName}</span>
                        <button type="button" onClick={() => {
                          if (q.templateFileData) {
                            fetch(q.templateFileData).then(r => r.blob()).then(blob => saveAs(blob, q.templateFileName!));
                          }
                        }} className="text-[10px] bg-slate-100 px-2 py-1 rounded font-black hover:bg-slate-200 text-slate-600">다운로드 테스트</button>
                        <button onClick={() => setQuestions(prev => prev.map(item => item.id === q.id ? { ...item, templateFileName: undefined, templateFileData: undefined } : item))} className="text-red-400 hover:text-red-600 font-black text-lg ml-1">✕</button>
                     </div>
                  ) : (
                    <label className="px-4 py-2 bg-white border border-teal-200 text-teal-600 rounded-xl text-[10px] font-black hover:bg-teal-50 shadow-sm transition-all cursor-pointer">
                      안내 양식 파일 찾아보기
                      <input type="file" className="hidden" onChange={(e) => handleFileUpload(q.id, e)} accept=".hwp,.pdf,.doc,.docx,.xls,.xlsx" />
                    </label>
                  )}
                </div>
              )}

              {/* 🚀 모든 문항/섹션 하단 다음 이동 경로 제어 */}
              {availableSections.length > 0 && (
                 <div className={`mt-4 pt-3 border-t ${q.type === 'SECTION' ? 'border-teal-200/50' : 'border-slate-200/60'}`}>
                    <label className={`text-[10px] font-black flex items-center gap-1 ${q.type === 'SECTION' ? 'text-teal-800' : 'text-slate-500'}`}>↳ 이 {q.type === 'SECTION' ? '섹션' : '항목'} 응답 후 다음 이동 경로:</label>
                    <select value={q.goToSectionId || ''} onChange={(e) => updateQuestion(q.id, 'goToSectionId', e.target.value)} className={`w-full mt-2 p-2.5 rounded-lg border text-[11px] font-bold outline-none text-teal-700 transition-colors ${q.type === 'SECTION' ? 'border-teal-200 bg-white' : 'border-slate-200 bg-slate-50 focus:bg-white focus:border-teal-400'}`}>
                      <option value="">순서대로 다음 항목 진행 (기본)</option>
                      <option value="SUBMIT">🏁 설문 제출하기 (여기서 즉시 종료)</option>
                      {availableSections.filter(s => s.id !== q.id).map(s => <option key={s.id} value={s.id}>➔ 다음 섹션 점프: {s.title || '제목 없는 섹션'}</option>)}
                    </select>
                 </div>
              )}
            </div>
  
            <div className="mt-8 pt-4 border-t border-slate-100 flex justify-end items-center gap-4">
              <button onClick={() => copyQuestion(q)} className="px-3 py-1.5 rounded-lg text-[10px] font-black text-slate-500 hover:bg-slate-100 transition-colors">📄 문항 복사</button>
              <button onClick={() => deleteQuestion(q.id)} className="px-3 py-1.5 rounded-lg text-[10px] font-black text-red-400 hover:bg-red-50 transition-colors">🗑️ 삭제</button>
              {q.type !== 'SECTION' && (
                <>
                  <div className="w-px h-6 bg-slate-200 mx-2"></div>
                  <label className="flex items-center gap-3 cursor-pointer select-none">
                    <span className={`text-[11px] font-black uppercase ${q.isRequired ? 'text-teal-600' : 'text-slate-400'}`}>필수 기입 사항</span>
                    <input type="checkbox" checked={q.isRequired} onChange={(e) => updateQuestion(q.id, 'isRequired', e.target.checked)} className="w-10 h-5 bg-slate-200 rounded-full appearance-none relative cursor-pointer before:absolute before:w-4 before:h-4 before:top-0.5 before:left-0.5 before:bg-white before:rounded-full before:shadow-md before:transition-all checked:bg-teal-600 checked:before:translate-x-5" />
                  </label>
                </>
              )}
            </div>
          </div>
        ))}
  
        {questions.length === 0 && (
          <div className="py-24 text-center border-2 border-dashed border-slate-200 rounded-[2.5rem] bg-white/50 flex flex-col items-center justify-center">
            <div className="text-5xl mb-4 opacity-50">✨</div>
            <h3 className="text-lg font-black text-slate-800">추가된 배달 배송지 정보 문항이 없습니다.</h3>
            <p className="text-xs font-bold text-slate-400 mt-2">하단의 다크 패널 툴바 버튼들을 조합하여 폼 설계를 시작하세요.</p>
          </div>
        )}
      </div>
  
      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-slate-900 p-2.5 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.3)] flex gap-1 border border-slate-700 z-50">
        <button onClick={() => addQuestion('CHOICE_SINGLE')} className="px-4 py-3 rounded-2xl text-[10px] font-black text-slate-300 hover:text-white hover:bg-slate-800 transition-all flex flex-col items-center gap-1.5"><span className="text-xl">⭕</span> 단일선택</button>
        <button onClick={() => addQuestion('CHOICE_MULTI')} className="px-4 py-3 rounded-2xl text-[10px] font-black text-slate-300 hover:text-white hover:bg-slate-800 transition-all flex flex-col items-center gap-1.5"><span className="text-xl">☑️</span> 다중선택</button>
        <div className="w-px bg-slate-700 mx-1 my-2"></div>
        <button onClick={() => addQuestion('TEXT_SHORT')} className="px-4 py-3 rounded-2xl text-[10px] font-black text-slate-300 hover:text-white hover:bg-slate-800 transition-all flex flex-col items-center gap-1.5"><span className="text-xl">✏️</span> 단답형</button>
        <button onClick={() => addQuestion('TEXT_LONG')} className="px-4 py-3 rounded-2xl text-[10px] font-black text-slate-300 hover:text-white hover:bg-slate-800 transition-all flex flex-col items-center gap-1.5"><span className="text-xl">📝</span> 장문형</button>
        <div className="w-px bg-slate-700 mx-1 my-2"></div>
        <button onClick={() => addQuestion('SEARCH_ADDRESS')} className="px-4 py-3 rounded-2xl text-[10px] font-black text-teal-300 hover:text-white hover:bg-teal-900/40 transition-all flex flex-col items-center gap-1.5"><span className="text-xl">📍</span> 검색형 주소</button>
        <button onClick={() => addQuestion('CALENDAR')} className="px-4 py-3 rounded-2xl text-[10px] font-black text-amber-300 hover:text-white hover:bg-amber-900/40 transition-all flex flex-col items-center gap-1.5"><span className="text-xl">📅</span> 배송요청일</button>
        <div className="w-px bg-slate-700 mx-1 my-2"></div>
        <button onClick={() => addQuestion('SCALE')} className="px-4 py-3 rounded-2xl text-[10px] font-black text-slate-300 hover:text-white hover:bg-slate-800 transition-all flex flex-col items-center gap-1.5"><span className="text-xl">⭐</span> 만족도</button>
        <button onClick={() => addQuestion('FILE')} className="px-4 py-3 rounded-2xl text-[10px] font-black text-slate-300 hover:text-white hover:bg-slate-800 transition-all flex flex-col items-center gap-1.5"><span className="text-xl">📂</span> 서식첨부</button>
        <div className="w-px bg-slate-700 mx-1 my-2"></div>
        <button onClick={() => addQuestion('SECTION')} className="px-4 py-2.5 rounded-xl text-[10px] font-black text-emerald-400 bg-emerald-950/40 border border-emerald-900/50 hover:bg-emerald-900/60 hover:text-white transition-all flex flex-col items-center gap-1"><span className="text-xl">🔖</span> 섹션추가</button>
      </div>
    </div>
  );
}