'use client';
  
import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { saveAs } from 'file-saver';
import { getKSTDateString, formatKSTCalendarLabel } from '@/utils/dateUtils';
import LoadingState from '@/components/common/LoadingState';
  
type QuestionType = 'CHOICE_SINGLE' | 'CHOICE_MULTI' | 'TEXT_SHORT' | 'TEXT_LONG' | 'SCALE' | 'FILE' | 'SEARCH_ADDRESS' | 'CALENDAR' | 'SECTION';
  
interface SurveyOption {
  label: string;
  imageUrl?: string;
  referenceLink?: string; 
  goToSectionId?: string;
  stockLimit?: string; // 🚀 재고 제한 수량 프로퍼티 신설!
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
  goToSectionId?: string;
}

const stripTitleOrderPrefix = (title: string) => String(title || '').replace(/^\d+\.\s*/, '');

const applyTitleOrderPrefixes = (list: Question[]) => {
  let n = 1;
  return list.map((q) => {
    if (q.type === 'SECTION') return q;
    return { ...q, title: `${n++}. ${stripTitleOrderPrefix(q.title)}` };
  });
};

const clearTitleOrderPrefixes = (list: Question[]) =>
  list.map((q) => (q.type === 'SECTION' ? q : { ...q, title: stripTitleOrderPrefix(q.title) }));
  
export default function SurveyBuilderPage() {
  const pathname = usePathname();
  const [surveyId, setSurveyId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [orderApplied, setOrderApplied] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [permReady, setPermReady] = useState(false);
  const [permissionSummary, setPermissionSummary] = useState<{
    masterName: string;
    accessDesignate: string;
    accessOrg: string;
    accessLevel: string;
    editDesignate: string;
    editLevel: string;
  } | null>(null);
  
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  const BUILDER_MENU_PATH = '/survey/general/admin/survey-builder';
  /** 권한 조회 전에는 편집 불가로 잠금 */
  const editAllowed = permReady && canEdit;

  const requireEdit = () => {
    if (editAllowed) return true;
    alert('권한이 없습니다.');
    return false;
  };
  
  useEffect(() => {
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
     
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    setSurveyId(id);

    // 빌더 메뉴 path만 사용 (active-surveys 등과 OR 합산·폴백 금지)
    fetch(`/api/survey/general?t=${Date.now()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'GET_ADMIN_CONTEXT', menuPath: BUILDER_MENU_PATH }),
      cache: 'no-store',
    })
      .then(async (res) => {
        if (!res.ok) {
          setCanEdit(false);
          setPermissionSummary(null);
          return;
        }
        const ctx = await res.json();
        setCanEdit(ctx?.canEdit === true);
        setPermissionSummary(ctx?.permissionSummary || null);
      })
      .catch(() => {
        setCanEdit(false);
        setPermissionSummary(null);
      })
      .finally(() => setPermReady(true));
  
    if (!id) {
      setLoading(false);
      alert('잘못된 접근입니다. 현황판에서 설문을 선택해 주세요.');
      window.location.href = '/survey/general/admin/active-surveys';
      return;
    }
  
    const ts = Date.now();
    fetch(`/api/survey/general?t=${ts}`, { cache: 'no-store' })
      .then(res => {
        if (!res.ok) throw new Error('API 로드 실패');
        return res.json();
      })
      .then(data => {
        if (Array.isArray(data)) {
          const targetSurvey = data.find((s: any) => s.id === id);
          
          if (!targetSurvey) {
            alert('존재하지 않거나 삭제된 설문입니다.');
            window.location.href = '/survey/general/admin/active-surveys';
            return;
          }

          if (targetSurvey.questions) {
            try {
              const parsed = typeof targetSurvey.questions === 'string' 
                ? JSON.parse(targetSurvey.questions) 
                : targetSurvey.questions;
                
              const targetArray = Array.isArray(parsed) ? parsed : [];
              
              const migratedData = targetArray.map((q: any) => ({
                ...q,
                options: q.options?.map((opt: any) => 
                  typeof opt === 'string' ? { label: opt, imageUrl: '', referenceLink: '', goToSectionId: '', stockLimit: '' } : opt
                )
              }));
              setQuestions(migratedData);
            } catch (e) {
              console.error("문항 구조 역직렬화 실패:", e);
              alert('문항 데이터를 불러오는 중 구조 오류가 발생했습니다. (데이터 손상 의심)');
            }
          }
        }
      })
      .catch(err => {
        console.error("DB 로드 실패:", err);
        alert('설문 데이터를 불러오는데 실패했습니다. 권한이나 네트워크 상태를 확인해 주세요.');
      })
      .finally(() => setLoading(false));
  }, [pathname]);

  const handleSort = () => {
    if (dragItem.current === null || dragOverItem.current === null) return;
    const _questions = [...questions];
    const draggedItemContent = _questions.splice(dragItem.current, 1)[0];
    _questions.splice(dragOverItem.current, 0, draggedItemContent);
    dragItem.current = null;
    dragOverItem.current = null;
    setQuestions(orderApplied ? applyTitleOrderPrefixes(_questions) : _questions);
  };

  const toggleOrderBatch = () => {
    if (!requireEdit()) return;
    if (orderApplied) {
      setQuestions((prev) => clearTitleOrderPrefixes(prev));
      setOrderApplied(false);
    } else {
      setQuestions((prev) => applyTitleOrderPrefixes(prev));
      setOrderApplied(true);
    }
  };
  
  const openPostcodeEngine = (qId: string) => {
    if (typeof window !== 'undefined' && (window as any).daum?.Postcode) {
      new (window as any).daum.Postcode({
        oncomplete: (data: any) => {
          setQuestions(prev => prev.map(q => q.id === qId ? { ...q, zipCode: data.zonecode, roadAddress: data.roadAddress || data.address } : q));
        }
      }).open();
    } else alert('주소 검색 엔진 로드 중입니다.');
  };
     
  const formatDisplayDate = (dateStr: string) => {
    if (!dateStr) return '날짜를 지정해 주세요.';
    const m = String(dateStr).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return formatKSTCalendarLabel(dateStr, dateStr);
    return `${Number(m[1])}년 ${Number(m[2])}월 ${Number(m[3])}일`;
  };
  
  const handleSaveSurvey = async () => {
    if (!requireEdit()) return;
    if (questions.length === 0) return alert('최소 1개 이상의 문항을 추가해주세요.');
    if (!surveyId) return alert('설문 ID가 유효하지 않습니다. 현황판에서 다시 진입해주세요.');
    
    try {
      const serializedLength = JSON.stringify(questions).length;
      if (serializedLength > 4500000) {
        return alert('❌ 문항 이미지 또는 서식 파일의 전체 물리 용량이 제한선(4.5MB)을 초과했습니다.\n파일 압축 후 재시도 하십시오.');
      }
    } catch (sizeError) {
      console.error("페이로드 크기 연산 오류:", sizeError);
    }
     
    try {
      const ts = Date.now();
      const getRes = await fetch(`/api/survey/general?t=${ts}`, { cache: 'no-store' });
      if (!getRes.ok) throw new Error('메타데이터 동기화 실패');
      const surveys = await getRes.json();
      const currentSurvey = surveys.find((s: any) => s.id === surveyId);
       
      if (!currentSurvey) return alert('해당 설문 공고를 시스템에서 찾을 수 없습니다.');
       
      const sanitizedQuestions = questions.map(q => ({
        ...q,
        options: q.options ? q.options.map(opt => ({ ...opt })) : undefined
      }));
     
      const payload = { ...currentSurvey, questions: sanitizedQuestions, menuPath: '/survey/general/admin/survey-builder' };
     
      const res = await fetch('/api/survey/general', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
     
      if (res.ok) {
        alert('✅ 설문 신청 양식 문항이 DB에 성공적으로 저장되었습니다!');
      } else {
        // 🚀 API 에러 파싱 로직 추가
        const errData = await res.json();
        alert(`❌ 저장 실패: ${errData.error || '서버 인프라 저장 처리 가드가 실패했습니다.'}`);
      }
    } catch (error) {
      alert('❌ 네트워크 인프라 인터페이스 통신 오류가 발생했습니다.');
    }
  };
  
  const addQuestion = (type: QuestionType) => {
    setQuestions([...questions, { 
      id: `Q_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`, type, title: type === 'SECTION' ? '새로운 섹션 단락' : '', isRequired: false, 
      options: type.includes('CHOICE') ? [{ label: '옵션 1', imageUrl: '', referenceLink: '', goToSectionId: '', stockLimit: '' }] : undefined, 
      scaleMax: type === 'SCALE' ? 5 : undefined,
      questionImageUrl: '', dummyDateValue: type === 'CALENDAR' ? getKSTDateString() : undefined,
      description: '', referenceLink: '', goToSectionId: ''
    }]);
  };
  
  const updateQuestion = (id: string, field: keyof Question, value: any) => {
    setQuestions(prev => prev.map(q => {
      if (q.id !== id) return q;
      
      // 🚀 문항 타입 변경 시 불필요한 더미 데이터 찌꺼기 완전 청소 (Clean up)
      if (field === 'type') {
        const newType = value as QuestionType;
        return {
          ...q,
          type: newType,
          options: newType.includes('CHOICE') ? [{ label: '옵션 1', imageUrl: '', referenceLink: '', goToSectionId: '', stockLimit: '' }] : undefined,
          scaleMax: newType === 'SCALE' ? 5 : undefined,
          dummyDateValue: newType === 'CALENDAR' ? getKSTDateString() : undefined,
          zipCode: undefined, roadAddress: undefined, detailAddress: undefined,
          templateFileName: undefined, templateFileData: undefined
        };
      }
      
      return { ...q, [field]: value };
    }));
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
    setQuestions(prev => prev.map(q => q.id === qId && q.options ? { ...q, options: [...q.options, { label: `옵션 ${q.options.length + 1}`, imageUrl: '', referenceLink: '', goToSectionId: '', stockLimit: '' }] } : q));
  };
  
  const removeOption = (qId: string, optIndex: number) => {
    setQuestions(prev => prev.map(q => q.id === qId && q.options ? { ...q, options: q.options.filter((_, idx) => idx !== optIndex) } : q));
  };
  
  const handleQuestionImage = (qId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { const reader = new FileReader(); reader.onload = (evt) => updateQuestion(qId, 'questionImageUrl', evt.target?.result as string); reader.readAsDataURL(file); }
  };
  
  const handleOptionImage = (qId: string, optIndex: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { const reader = new FileReader(); reader.onload = (evt) => updateOption(qId, optIndex, 'imageUrl', evt.target?.result as string); reader.readAsDataURL(file); }
  };
  
  const handleFileUpload = (qId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { 
      const reader = new FileReader(); 
      reader.onload = (evt) => { 
        setQuestions(prev => prev.map(q => q.id === qId ? { ...q, templateFileName: file.name, templateFileData: evt.target?.result as string } : q)); 
      }; 
      reader.readAsDataURL(file); 
    }
  };
     
  const availableSections = questions.filter(q => q.type === 'SECTION');
  
  if (loading) return <LoadingState />;

  const questionNoById: Record<string, number> = {};
  {
    let n = 1;
    questions.forEach((q) => {
      if (q.type !== 'SECTION') questionNoById[q.id] = n++;
    });
  }

  return (
    <div className="min-h-screen bg-slate-100 font-sans text-slate-900 pb-32 animate-fade-in relative text-[11px]">
      <div className="sticky top-0 z-50 bg-white border-b border-slate-200 px-8 py-4 shadow-sm">
        <div className="flex justify-between items-center gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <Link href="/survey/general/admin/active-surveys" className="px-3 py-2 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors font-black text-[11px] text-slate-600 shrink-0">⬅️ 현황판으로 돌아가기</Link>
            <div className="h-6 w-px bg-slate-200 mx-2 shrink-0"></div>
            <div className="min-w-0">
              <h1 className="text-lg font-black text-slate-800">🛠️ 설문지 생성기 (Builder Engine)</h1>
              <p className="text-[10px] text-slate-400 font-bold mt-0.5">문항을 마우스로 드래그하여 배치 순서를 바꿀 수 있습니다.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {permReady && !editAllowed && (
              <span className="px-3 py-1.5 bg-amber-50 border border-amber-200 text-amber-700 rounded-lg text-[10px] font-black whitespace-nowrap">
                🔒 편집 제한
              </span>
            )}
            <button
              type="button"
              onClick={toggleOrderBatch}
              className={`px-4 py-2.5 rounded-xl text-xs font-black transition-all ${
                !editAllowed
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed opacity-60'
                  : orderApplied
                  ? 'bg-amber-500 text-white hover:bg-amber-600 shadow-sm'
                  : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
              title={orderApplied ? '제목에 부여된 순번(1. 2. …)을 제거합니다' : '보이는 순번을 제목 앞자리에 고정 문구로 넣습니다'}
            >
              {orderApplied ? '순서부여 취소' : '순서일괄부여'}
            </button>
            <button
              type="button"
              onClick={() => {
                if (!requireEdit()) return;
                if (confirm('모든 문항을 지우시겠습니까?')) {
                  setQuestions([]);
                  setOrderApplied(false);
                }
              }}
              className={`px-4 py-2.5 rounded-xl text-xs font-black transition-all ${
                editAllowed
                  ? 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  : 'bg-slate-200 text-slate-400 cursor-not-allowed opacity-60'
              }`}
            >
              초기화
            </button>
            <button
              type="button"
              onClick={handleSaveSurvey}
              className={`px-6 py-2.5 rounded-xl text-[11px] font-black shadow-lg transition-all ${
                editAllowed
                  ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                  : 'bg-slate-300 text-slate-500 cursor-not-allowed opacity-60'
              }`}
            >
              💾 설문 문항 저장
            </button>
          </div>
        </div>
        {permissionSummary && (
          <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-slate-100">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-black border tracking-tight bg-blue-50 border-blue-200 text-blue-700 shadow-sm">
              <span>👑 Master 책임자:</span>
              <span>{permissionSummary.masterName}</span>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-black border tracking-tight bg-purple-50 border-purple-200 text-purple-700 shadow-sm">
              <span>👁️ Access:</span>
              <span>{permissionSummary.accessDesignate}</span>
              <span className="opacity-50">|</span>
              <span className="truncate max-w-[160px]">Org: {permissionSummary.accessOrg}</span>
              <span className="opacity-50">|</span>
              <span>Level: {permissionSummary.accessLevel}</span>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-black border tracking-tight bg-emerald-50 border-emerald-200 text-emerald-700 shadow-sm">
              <span>✍️ Edit:</span>
              <span>{permissionSummary.editDesignate}</span>
              <span className="opacity-50">|</span>
              <span>Level: {permissionSummary.editLevel}</span>
            </div>
            {!editAllowed && (
              <span className="text-[10px] font-black text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-md">
                현재 계정: 조회만 가능 (편집 권한 없음)
              </span>
            )}
          </div>
        )}
      </div>
  
      <div className="max-w-[800px] mx-auto mt-8 space-y-4">
        {questions.map((q, index) => (
          <div 
            key={q.id} draggable onDragStart={() => (dragItem.current = index)} onDragEnter={() => (dragOverItem.current = index)} onDragEnd={handleSort} onDragOver={(e) => e.preventDefault()}
            className={`bg-white p-6 rounded-3xl border shadow-sm relative group focus-within:ring-2 focus-within:ring-indigo-500 transition-all ${q.type === 'SECTION' ? 'border-l-8 border-l-indigo-600 border-slate-200 bg-indigo-50/10' : 'border-slate-200'}`}
          >
            <div className="absolute top-1.5 left-1/2 -translate-x-1/2 cursor-grab text-slate-300 hover:text-indigo-500 font-bold select-none opacity-0 group-hover:opacity-100 transition-opacity text-xs tracking-widest">
              ⠿ Drag & Drop Move ⠿
            </div>
            
            <div className="flex flex-wrap md:flex-nowrap justify-between items-start gap-4 mb-4 mt-2">
              <div className="flex-1 flex gap-3 w-full">
                <span className={`text-lg font-black mt-1 ${q.type === 'SECTION' ? 'text-indigo-600' : 'text-slate-300'}`}>
                  {q.type === 'SECTION' ? '🔖' : `${questionNoById[q.id]}.`}
                </span>
                <div className="w-full flex flex-col gap-1">
                  <input 
                    type="text" value={q.title} onChange={(e) => updateQuestion(q.id, 'title', e.target.value)}
                    className={`w-full bg-slate-50 p-3.5 rounded-xl border border-transparent focus:border-indigo-300 focus:bg-white outline-none font-bold ${q.type === 'SECTION' ? 'text-sm text-indigo-700 bg-indigo-50/50' : 'text-[13px]'}`}
                    placeholder={q.type === 'SECTION' ? "구분용 대단락 섹션 라벨을 명시하세요" : "질문을 입력해주세요"}
                  />
                  
                  {q.type !== 'SECTION' && !['SCALE', 'FILE', 'SEARCH_ADDRESS', 'CALENDAR'].includes(q.type) && (
                    <div className="mt-1">
                      <div className="flex items-center gap-3">
                        <label className="cursor-pointer px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-[10px] font-black text-slate-500 transition-colors">
                          {q.questionImageUrl ? '📷 메인 이미지 변경' : '📷 메인 이미지 추가'}
                          <input type="file" className="hidden" accept="image/*" onChange={(e) => handleQuestionImage(q.id, e)} />
                        </label>
                        {q.questionImageUrl && <button onClick={() => updateQuestion(q.id, 'questionImageUrl', '')} className="text-[10px] text-red-400 font-bold hover:underline">이미지 삭제</button>}
                      </div>
                      {q.questionImageUrl && <img src={q.questionImageUrl} alt="Question" className="mt-2 max-h-40 rounded-xl border border-slate-200 object-contain" />}
                    </div>
                  )}
                </div>
              </div>
              
              <select value={q.type} onChange={(e) => updateQuestion(q.id, 'type', e.target.value as QuestionType)} className="w-full md:w-48 p-3.5 bg-white border border-slate-200 rounded-xl text-[11px] font-black text-slate-600 outline-none focus:border-indigo-500 cursor-pointer shadow-sm">
                <option value="CHOICE_SINGLE">⭕ 단일 선택 (Radio)</option>
                <option value="CHOICE_MULTI">☑️ 다중 선택 (Checkbox)</option>
                <option value="TEXT_SHORT">✏️ 단답형 입력</option>
                <option value="TEXT_LONG">📝 장문형 입력</option>
                <option value="SEARCH_ADDRESS">📍 검색형 주소</option>
                <option value="CALENDAR">📅 날짜 달력</option>
                <option value="SCALE">⭐ 척도형 (만족도)</option>
                <option value="FILE">📂 파일 첨부형</option>
                <option value="SECTION">🔖 섹션 구분 단락</option>
              </select>
            </div>
  
            <div className="pl-8 pt-2">
              {q.type !== 'SECTION' && (
                <div className="mb-6 space-y-3 p-4 bg-indigo-50/50 border border-indigo-100 rounded-xl">
                  <div>
                    <label className="text-[10px] font-black text-indigo-800 mb-1 block">💡 문항 부가 설명 / 가이드라인 (선택)</label>
                    <textarea value={q.description || ''} onChange={(e) => updateQuestion(q.id, 'description', e.target.value)} className="w-full p-2.5 border border-indigo-200 rounded-lg text-xs font-bold outline-none focus:border-indigo-400 min-h-[50px]" placeholder="응답자에게 보여줄 상세한 안내 사항을 입력하세요." />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-indigo-800 mb-1 block">🔗 외부 참조 링크 URL (선택)</label>
                    <input type="text" value={q.referenceLink || ''} onChange={(e) => updateQuestion(q.id, 'referenceLink', e.target.value)} className="w-full p-2.5 border border-indigo-200 rounded-lg text-xs font-bold outline-none focus:border-indigo-400" placeholder="https://..." />
                  </div>
                </div>
              )}
  
              {q.type === 'SEARCH_ADDRESS' && (
                <div className="space-y-2.5 max-w-xl bg-slate-50 p-5 border border-slate-200 rounded-2xl animate-fade-in">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 bg-white border border-slate-300 rounded-xl px-3 py-1.5 shadow-sm"><span className="font-black text-slate-500 text-[10px] whitespace-nowrap shrink-0">우편번호</span><input type="text" value={q.zipCode || ''} readOnly className="w-20 text-center font-black text-indigo-600 text-xs outline-none bg-transparent" /></div>
                    <button type="button" onClick={() => openPostcodeEngine(q.id)} className="px-4 py-2 bg-slate-900 text-white rounded-xl text-[10px] font-black hover:bg-slate-800 transition-all shrink-0">🔍 주소지 검색</button>
                  </div>
                  <div className="flex items-center gap-2 bg-white border border-slate-300 rounded-xl px-3 py-2 shadow-sm"><span className="font-black text-slate-400 text-[10px] whitespace-nowrap shrink-0">기본주소</span><input type="text" value={q.roadAddress || ''} readOnly className="w-full text-xs font-bold text-slate-700 outline-none bg-transparent" /></div>
                  <div className="flex items-center gap-2 bg-white border border-indigo-400 rounded-xl px-3 py-2 shadow-sm"><span className="font-black text-indigo-600 text-[10px] whitespace-nowrap shrink-0">상세주소</span><input type="text" value={q.detailAddress || ''} onChange={(e) => updateQuestion(q.id, 'detailAddress', e.target.value)} className="w-full text-xs font-bold text-slate-800 outline-none bg-transparent" /></div>
                </div>
              )}
     
              {q.type === 'CALENDAR' && (
                <div className="space-y-3 bg-slate-50 p-4 border border-slate-200 rounded-2xl max-w-md animate-fade-in">
                  <div className="flex items-center gap-3"><span className="text-xs font-black text-slate-600">날짜 지정:</span><input type="date" value={q.dummyDateValue || ''} onChange={(e) => updateQuestion(q.id, 'dummyDateValue', e.target.value)} className="p-2 border border-slate-300 rounded-xl bg-white text-xs font-black outline-none focus:border-indigo-500" /></div>
                  <div className="p-2.5 bg-white border border-indigo-100 rounded-xl text-[11px] font-black text-slate-800">실제 화면 노출 규격: <span className="text-indigo-600 underline font-extrabold">{formatDisplayDate(q.dummyDateValue || '')}</span></div>
                </div>
              )}
     
              {(q.type === 'CHOICE_SINGLE' || q.type === 'CHOICE_MULTI') && (
                <div className="space-y-3">
                  {q.options?.map((opt, oIdx) => (
                    <div key={oIdx} className="flex flex-col gap-2 p-3 bg-slate-50 border border-slate-200 rounded-xl group/opt">
                      <div className="flex items-center gap-3">
                        <span className="text-slate-300 text-lg">{q.type === 'CHOICE_SINGLE' ? '○' : '□'}</span>
                        <input type="text" value={opt.label} onChange={(e) => updateOption(q.id, oIdx, 'label', e.target.value)} className="flex-1 border-b border-transparent hover:border-slate-300 focus:border-indigo-500 outline-none py-1.5 text-xs text-slate-700 font-bold bg-transparent min-w-[120px]" />
                        
                        {/* 🚀 재고(선착순) 제한 입력 폼 신설 */}
                        <input type="number" min="0" value={opt.stockLimit || ''} onChange={(e) => updateOption(q.id, oIdx, 'stockLimit', e.target.value)} className="w-20 px-2 py-1.5 bg-white border border-pink-200 text-pink-600 focus:border-pink-500 rounded text-[10px] font-black outline-none" placeholder="재고(수량)" title="입력하지 않으면 무제한입니다." />
                        
                        <input type="text" value={opt.referenceLink || ''} onChange={(e) => updateOption(q.id, oIdx, 'referenceLink', e.target.value)} className="w-32 px-2 py-1.5 bg-white border border-slate-200 rounded text-[10px] font-medium outline-none" placeholder="🔗 외부링크 URL" />
     
                        <label className="cursor-pointer px-2.5 py-1.5 border border-slate-300 bg-white hover:bg-slate-100 rounded text-[10px] font-black text-slate-600 transition-colors shrink-0">
                          {opt.imageUrl ? '이미지 변경' : '이미지 추가'}
                          <input type="file" className="hidden" accept="image/*" onChange={(e) => handleOptionImage(q.id, oIdx, e)} />
                        </label>
                        {opt.imageUrl && <button onClick={() => updateOption(q.id, oIdx, 'imageUrl', '')} className="text-[10px] text-red-400 font-black shrink-0">삭제</button>}
                        {q.options!.length > 1 && <button onClick={() => removeOption(q.id, oIdx)} className="text-slate-300 hover:text-red-500 px-2 font-black">✕</button>}
                      </div>
     
                      {opt.imageUrl && <div className="ml-8 mt-1 relative w-fit"><img src={opt.imageUrl} className="h-16 rounded border object-cover" /></div>}
     
                      {availableSections.length > 0 && (
                        <div className="ml-8 flex items-center gap-2 border-t border-slate-200/60 pt-2 mt-1">
                          <span className="text-[10px] text-slate-400 font-bold">↳ 이 타겟 선택 시:</span>
                          <select value={opt.goToSectionId || ''} onChange={(e) => updateOption(q.id, oIdx, 'goToSectionId', e.target.value)} className="p-1 border bg-white rounded text-[10px] outline-none text-indigo-600 font-bold cursor-pointer">
                            <option value="">다음 문항으로 계속 진행 (기본)</option>
                            <option value="SUBMIT">🏁 이대로 답변 제출 및 종료</option>
                            {availableSections.map(s => <option key={s.id} value={s.id}>➔ 섹션: {s.title || '제목 없음'} (으)로 점프</option>)}
                          </select>
                        </div>
                      )}
                    </div>
                  ))}
                  <button onClick={() => addOption(q.id)} className="text-[11px] font-black text-blue-500 hover:underline px-2 py-1">옵션 추가하기</button>
                </div>
              )}
  
              {(q.type === 'TEXT_SHORT' || q.type === 'TEXT_LONG') && (
                <div className={`border-b-2 border-dashed border-slate-200 text-slate-400 text-xs py-2 font-bold w-1/2 ${q.type === 'TEXT_LONG' ? 'w-full pb-10' : ''}`}>
                  {q.type === 'TEXT_SHORT' ? '단답형 텍스트 영역' : '장문형 텍스트 (여러 줄 입력 가능)'}
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
              
              {q.type === 'FILE' && (
                <div className="mt-2 p-5 border-2 border-dashed border-indigo-200 rounded-2xl flex flex-col items-start gap-3 bg-indigo-50/50">
                  <div className="flex items-center gap-2"><span className="text-xl">📥</span><div><p className="text-[11px] font-black text-indigo-800">응답자 제공용 빈 양식 파일 첨부 (필수/선택)</p><p className="text-[9px] text-slate-500 font-bold mt-0.5">사용자가 다운받아 작성 후 다시 업로드할 빈 양식을 등록해주세요.</p></div></div>
                  {q.templateFileName ? (
                     <div className="flex items-center gap-3 bg-white px-4 py-2 border border-indigo-100 rounded-xl shadow-sm w-full max-w-md">
                        <span className="text-lg">📄</span><span className="flex-1 text-[11px] font-bold text-slate-700 truncate">{q.templateFileName}</span>
                        <button type="button" onClick={() => { if (q.templateFileData) { fetch(q.templateFileData).then(r => r.blob()).then(blob => saveAs(blob, q.templateFileName!)); } }} className="text-[10px] bg-slate-100 px-2 py-1 rounded font-black hover:bg-slate-200 text-slate-600">다운로드 테스트</button>
                        <button onClick={() => setQuestions(prev => prev.map(item => item.id === q.id ? { ...item, templateFileName: undefined, templateFileData: undefined } : item))} className="text-red-400 hover:text-red-600 font-black text-lg ml-1">✕</button>
                     </div>
                  ) : (
                    <label className="px-4 py-2 bg-white border border-indigo-200 text-indigo-600 rounded-xl text-[10px] font-black hover:bg-indigo-50 shadow-sm transition-all cursor-pointer">빈 양식 파일 찾아보기<input type="file" className="hidden" onChange={(e) => handleFileUpload(q.id, e)} accept=".hwp,.pdf,.doc,.docx,.xls,.xlsx" /></label>
                  )}
                </div>
              )}
     
              {availableSections.length > 0 && (
                 <div className="mt-4 pt-3 border-t border-slate-200/60">
                    <label className="text-[10px] font-black text-slate-500 flex items-center gap-1">↳ 이 항목 응답 후 다음 이동 경로:</label>
                    <select value={q.goToSectionId || ''} onChange={(e) => updateQuestion(q.id, 'goToSectionId', e.target.value)} className="w-full mt-2 p-2.5 rounded-lg border border-slate-200 text-[11px] font-bold outline-none text-indigo-700 bg-slate-50 focus:bg-white focus:border-indigo-400 transition-colors cursor-pointer">
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
                    <span className={`text-[11px] font-black uppercase ${q.isRequired ? 'text-indigo-600' : 'text-slate-400'}`}>필수 문항</span>
                    <input type="checkbox" checked={q.isRequired} onChange={(e) => updateQuestion(q.id, 'isRequired', e.target.checked)} className="w-10 h-5 bg-slate-200 rounded-full appearance-none relative cursor-pointer before:absolute before:w-4 before:h-4 before:top-0.5 before:left-0.5 before:bg-white before:rounded-full before:shadow-md before:transition-all checked:bg-indigo-500 checked:before:translate-x-5" />
                  </label>
                </>
              )}
            </div>
          </div>
        ))}
  
        {questions.length === 0 && (
          <div className="py-24 text-center border-2 border-dashed border-slate-200 rounded-[2.5rem] bg-white/50 flex flex-col items-center justify-center">
            <div className="text-5xl mb-4 opacity-50">✨</div><h3 className="text-lg font-black text-slate-800">아직 추가된 문항이 없습니다.</h3><p className="text-xs font-bold text-slate-400 mt-2">하단의 툴바에서 문항을 추가하고 드래그앤드롭으로 이동하세요.</p>
          </div>
        )}
      </div>
  
      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-slate-900 p-2.5 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.3)] flex gap-1 border border-slate-700 z-50">
        <button onClick={() => addQuestion('CHOICE_SINGLE')} className="px-3 py-2.5 rounded-xl text-[10px] font-black text-slate-300 hover:text-white hover:bg-slate-800 transition-all flex flex-col items-center gap-1"><span className="text-base">⭕</span> 단일선택</button>
        <button onClick={() => addQuestion('CHOICE_MULTI')} className="px-3 py-2.5 rounded-xl text-[10px] font-black text-slate-300 hover:text-white hover:bg-slate-800 transition-all flex flex-col items-center gap-1"><span className="text-base">☑️</span> 다중선택</button>
        <button onClick={() => addQuestion('TEXT_SHORT')} className="px-3 py-2.5 rounded-xl text-[10px] font-black text-slate-300 hover:text-white hover:bg-slate-800 transition-all flex flex-col items-center gap-1"><span className="text-base">✏️</span> 단답형</button>
        <button onClick={() => addQuestion('TEXT_LONG')} className="px-3 py-2.5 rounded-xl text-[10px] font-black text-slate-300 hover:text-white hover:bg-slate-800 transition-all flex flex-col items-center gap-1"><span className="text-base">📝</span> 장문형</button>
        <div className="w-px bg-slate-700 mx-1.5 my-2"></div>
        <button onClick={() => addQuestion('SEARCH_ADDRESS')} className="px-3 py-2.5 rounded-xl text-[10px] font-black text-indigo-300 hover:text-white hover:bg-slate-800 transition-all flex flex-col items-center gap-1"><span className="text-base">📍</span> 주소검색</button>
        <button onClick={() => addQuestion('CALENDAR')} className="px-3 py-2.5 rounded-xl text-[10px] font-black text-amber-300 hover:text-white hover:bg-slate-800 transition-all flex flex-col items-center gap-1"><span className="text-base">📅</span> 달력날짜</button>
        <button onClick={() => addQuestion('SCALE')} className="px-3 py-2.5 rounded-xl text-[10px] font-black text-slate-300 hover:text-white hover:bg-slate-800 transition-all flex flex-col items-center gap-1"><span className="text-base">⭐</span> 만족도</button>
        <button onClick={() => addQuestion('FILE')} className="px-3 py-2.5 rounded-xl text-[10px] font-black text-slate-300 hover:text-white hover:bg-slate-800 transition-all flex flex-col items-center gap-1"><span className="text-base">📂</span> 파일양식</button>
        <div className="w-px bg-slate-700 mx-1.5 my-2"></div>
        <button onClick={() => addQuestion('SECTION')} className="px-4 py-2.5 rounded-xl text-[10px] font-black text-emerald-400 bg-emerald-950/40 border border-emerald-900/50 hover:bg-emerald-900/60 hover:text-white transition-all flex flex-col items-center gap-1"><span className="text-base">🔖</span> 섹션추가</button>
      </div>
    </div>
  );
}