'use client';
     
import React, { useState, useMemo, useEffect, Fragment } from 'react';
import Link from 'next/link';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import * as XLSX from 'xlsx';
import { usePathname, useRouter } from 'next/navigation'; // 🚀 내비게이션 도구 통합
import { getKSTDateString } from '@/utils/dateUtils';
     
const getStatusBadge = (status: string) => {
  switch (status) {
    case '게시전': return 'bg-slate-100 text-slate-500 border border-slate-200';
    case '게시중단': return 'bg-amber-100 text-amber-700';
    case '진행중': return 'bg-blue-100 text-blue-700';
    case '완료': return 'bg-emerald-100 text-emerald-700';
    default: return 'bg-slate-100 text-slate-500';
  }
};
     
export default function AdminDeliveryActiveModule() {
  const pathname = usePathname(); // 🚀 추가
  const router = useRouter();     // 🚀 추가
  const [surveys, setSurveys] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [deptList, setDeptList] = useState<string[]>([]);
  const [unitsList, setUnitsList] = useState<any[]>([]);
  const [responses, setResponses] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
     
  const [deliveryTab, setDeliveryTab] = useState<'ALL' | 'ALWAYS' | 'PERIOD'>('ALL');
  const [surveyListFilter, setSurveyListFilter] = useState<'ALL' | 'ONGOING' | 'CLOSING_TODAY'>('ALL');
  const [matrixUserFilter, setMatrixUserFilter] = useState<{ surveyId: string, type: 'DONE' | 'NOT_DONE' | 'ALL' }>({ surveyId: '', type: 'ALL' });
  const [collapsedDepts, setCollapsedDepts] = useState<Set<string>>(new Set());
     
  const [selectedCellKeys, setSelectedCellKeys] = useState<Set<string>>(new Set());
     
  const [editModal, setEditModal] = useState<any | null>(null);
  const [previewModal, setPreviewModal] = useState<any | null>(null);
  const [nudgeModal, setNudgeModal] = useState<{ surveyId: string, title: string, count: number, targetEmails: string[] } | null>(null);
  const [pendingModalType, setPendingModalType] = useState<'ALWAYS' | 'PERIOD' | null>(null);
     
  const todayStr = getKSTDateString();
     
  useEffect(() => {
    const fetchOrgData = async () => {
      try {
        const [surveyRes, uRes, unitRes] = await Promise.all([
          fetch('/api/survey/delivery'),
          fetch('/api/admin/users'),
          fetch('/api/admin/units?active=true')
        ]);
     
        let dbSurveys = [];
        if (surveyRes.ok) {
          dbSurveys = await surveyRes.json();
          setSurveys(dbSurveys);
        }
     
        if (uRes.ok && unitRes.ok) {
          const uData = await uRes.json();
          const unitData = await unitRes.json();
          setUnitsList(unitData);
          setDeptList(unitData.map((u: any) => u.unit_name));
     
          const mappedUsers = (uData.users || []).map((u: any) => ({
            ...u,
            dept: unitData.find((un: any) => un.id === u.unit_id)?.unit_name || '소속없음'
          }));
          setUsers(mappedUsers);
        }
     
        const responseRes = await fetch('/api/survey/delivery', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'GET_RESPONSES' })
        });
        if (responseRes.ok) {
          const dbResponses = await responseRes.json(); 
          
          const realRes: Record<string, any> = {};
          dbResponses.forEach((r: any) => {
            realRes[`${r.surveyId}_${r.userEmail}`] = {
              isDone: true,
              date: r.submittedAt ? r.submittedAt.split('T')[0] : '-',
              fullDate: r.submittedAt,
              result: '제출완료',
              answers: r.answers,
              isApproved: r.isApproved,
              approvedAt: r.approvedAt ? r.approvedAt.split('T')[0] : null,
              feedbackAt: r.feedbackAt ? r.feedbackAt.split('T')[0] : null,
              feedbackMsg: r.feedbackMsg,
              revisionCount: r.revisionCount,
              isRevoked: r.isRevoked
            };
          });
          setResponses(realRes);
        }
      } catch (error) { 
        console.error("Infrastructure Sync Error:", error); 
      } finally { 
        setLoading(false); 
      }
    };
    fetchOrgData();
  }, []);
     
// 🚀 1. 함수를 먼저 정의합니다! (여기로 이동 완료)
const isOrgAllowed = (targetDepts: string[], userDeptName: string) => {
  if (targetDepts.includes('전사')) return true;
  if (targetDepts.includes(userDeptName)) return true;
  let currentUnit = unitsList.find(u => u.unit_name === userDeptName);
  while (currentUnit && currentUnit.parent_id) {
    const parentUnit = unitsList.find(u => u.id === currentUnit.parent_id);
    if (parentUnit && targetDepts.includes(parentUnit.unit_name)) return true;
    currentUnit = parentUnit;
  }
  return false;
};

// 🚀 2. 이제 에러 없이 필터 함수를 안전하게 사용할 수 있습니다.
const pendingAlwaysApprovals = useMemo(() => {
  const pendings: any[] = [];
  surveys.filter(s => s.deliveryType === 'ALWAYS').forEach(survey => {
    const targetDepts = survey.target ? survey.target.split(',').map((t: string) => t.trim()) : ['전사'];
    users.forEach(user => {
      // 여기서 isOrgAllowed를 호출함
      if (isOrgAllowed(targetDepts, user.dept)) {
        const resp = responses[`${survey.id}_${user.email}`];
        if (resp && resp.isDone && !resp.isApproved) pendings.push({ survey, user, resp });
      }
    });
  });
  return pendings.sort((a, b) => new Date(b.resp.fullDate).getTime() - new Date(a.resp.fullDate).getTime());
}, [surveys, users, responses, unitsList]);
     
  const pendingPeriodApprovals = useMemo(() => {
    const pendings: any[] = [];
    surveys.filter(s => s.deliveryType === 'PERIOD').forEach(survey => {
      const targetDepts = survey.target ? survey.target.split(',').map((t: string) => t.trim()) : ['전사'];
      users.forEach(user => {
        if (isOrgAllowed(targetDepts, user.dept)) {
          const resp = responses[`${survey.id}_${user.email}`];
          if (resp && resp.isDone && !resp.isApproved) pendings.push({ survey, user, resp });
        }
      });
    });
    return pendings.sort((a, b) => new Date(b.resp.fullDate).getTime() - new Date(a.resp.fullDate).getTime());
  }, [surveys, users, responses, unitsList]);
   
  const stats = useMemo(() => ({
    activeCount: surveys.filter(s => s.status === '진행중').length,
    closingTodayCount: surveys.filter(s => s.status === '진행중' && s.endDate === todayStr).length,
    pendingAlwaysCount: pendingAlwaysApprovals.length,
    pendingPeriodCount: pendingPeriodApprovals.length 
  }), [surveys, todayStr, pendingAlwaysApprovals, pendingPeriodApprovals]);
     
  const sortedSurveys = useMemo(() => [...surveys].sort((a, b) => a.postNumber - b.postNumber), [surveys]);
     
  const filteredSurveys = useMemo(() => {
    let list = sortedSurveys.filter(s => s.status !== '보관됨');
    if (surveyListFilter === 'ONGOING') list = list.filter(s => s.status === '진행중');
    else if (surveyListFilter === 'CLOSING_TODAY') list = list.filter(s => s.status === '진행중' && s.endDate === todayStr);
    if (deliveryTab === 'ALWAYS') list = list.filter(s => s.deliveryType === 'ALWAYS');
    if (deliveryTab === 'PERIOD') list = list.filter(s => s.deliveryType === 'PERIOD');
    return list;
  }, [sortedSurveys, surveyListFilter, deliveryTab, todayStr]);
     
  const groupedUsers = useMemo(() => {
    const groups: Record<string, any[]> = {};
    users.forEach(u => {
      if (!groups[u.dept]) groups[u.dept] = [];
      groups[u.dept].push(u);
    });
    return groups;
  }, [users]);
     
  const toggleDept = (dept: string) => { const next = new Set(collapsedDepts); next.has(dept) ? next.delete(dept) : next.add(dept); setCollapsedDepts(next); };
  const collapseAll = () => setCollapsedDepts(new Set(Object.keys(groupedUsers)));
  const expandAll = () => { setCollapsedDepts(new Set()); setMatrixUserFilter({ surveyId: '', type: 'ALL' }); };
 
     
  const handleCopyUnsubmittedEmails = (survey: any) => {
    const targetDepts = survey.target.split(',').map((t: string) => t.trim());
    const targetUsers = users.filter(u => isOrgAllowed(targetDepts, u.dept));
    const unsubmitted = targetUsers.filter(u => !responses[`${survey.id}_${u.email}`]?.isDone);
     
    if (unsubmitted.length === 0) return alert('현재 미참여자가 없습니다.');
    const emails = unsubmitted.map(u => u.email).join(', ');
    navigator.clipboard.writeText(emails);
    alert(`미참여자 ${unsubmitted.length}명의 이메일이 클립보드에 복사되었습니다.\n(메일 클라이언트의 '받는 사람' 란에 바로 붙여넣기 하세요.)`);
  };
     
  const handleAddSurvey = () => {
    const maxPostNum = surveys.length > 0 ? Math.max(0, ...surveys.map((s: any) => Number(s.postNumber) || 0)) : 100;
    
    const defaultDeliveryType = deliveryTab === 'PERIOD' ? 'PERIOD' : 'ALWAYS';
     
    setEditModal({
      id: `D_${Date.now()}`,
      code: `DEL-NEW-${Date.now().toString().slice(-4)}`,
      postNumber: maxPostNum + 1,
      title: '새로운 배달 복지 공고',
      description: '',
      type: '선택형',
      deliveryType: defaultDeliveryType,
      target: '전사',
      isAnonymous: false,
      postDate: todayStr,
      startDate: todayStr,
      endDate: todayStr,
      endTime: '23:59', // 💡 [추가됨] 새 공고 열 때 기본 시간 세팅
      status: '게시전',
      hasBeenPublished: false
    });
  };
     
  const toggleTarget = (dept: string) => {
    const currentTargets = editModal.target.split(',').map((s: string) => s.trim()).filter(Boolean);
    let nextTargets = new Set(currentTargets);
    if (dept === '전사') nextTargets = new Set(['전사']);
    else {
      nextTargets.delete('전사');
      nextTargets.has(dept) ? nextTargets.delete(dept) : nextTargets.add(dept);
      if (nextTargets.size === 0) nextTargets.add('전사');
    }
    setEditModal({ ...editModal, target: Array.from(nextTargets).join(', ') });
  };
     
  const handleDeleteSurvey = async (id: string) => {
    if (!confirm('이 배달 공고를 삭제하시겠습니까?\n이 데이터 복지 명세는 영구 소멸됩니다.')) return;
    try {
      const res = await fetch(`/api/survey/delivery?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        setSurveys(prev => prev.filter(s => s.id !== id));
      } else {
        alert('삭제 처리 중 오류가 발생했습니다.');
      }
    } catch (e) {
      console.error(e);
      alert('네트워크 오류가 발생했습니다.');
    }
  };
     
  const handleStatusChange = async (id: string, action: 'UP' | 'DOWN' | 'ARCHIVE' | 'FORCE_COMPLETE') => {
    const survey = surveys.find(s => s.id === id);
    if (!survey) return;
     
    // 🚀 이 변수 선언이 지워져서 에러가 났던 것입니다! 복구 완료.
    let updatedSurvey = { ...survey };
    
    if (action === 'UP') updatedSurvey = { ...updatedSurvey, status: '진행중', postDate: todayStr, hasBeenPublished: true };
    if (action === 'DOWN') updatedSurvey = { ...updatedSurvey, status: '게시중단' };
    if (action === 'FORCE_COMPLETE') {
      if (!confirm("이 공고를 즉시 마감 처리하시겠습니까?\n마감된 공고는 즉시 이력 보관함으로 이동됩니다.")) return;
      updatedSurvey = { ...updatedSurvey, status: '완료' };
    }
    if (action === 'ARCHIVE') {
      if (!confirm("이 공고를 보관함으로 이동하시겠습니까?")) return; // 🚀 확인창 추가
      updatedSurvey = { ...updatedSurvey, status: '보관됨' };
    }
     
    try {
      const res = await fetch('/api/survey/delivery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedSurvey)
      });
      
      if (res.ok) {
        const savedSurvey = await res.json();
        setSurveys(prev => prev.map(s => s.id === id ? savedSurvey : s));
        if (action === 'ARCHIVE') alert('✅ 보관함으로 성공적으로 이동되었습니다.'); // 🚀 성공 시 얼럿
      } else {
        alert('❌ 서버 처리 중 오류가 발생했습니다.');
      }
    } catch (e) {
      console.error("Status Change Error:", e);
      alert('❌ 네트워크 오류가 발생했습니다.');
    }
  };
  
  const handleNudge = (surveyId: string) => {
    const survey = surveys.find(s => s.id === surveyId);
    const targetDepts = survey.target.split(',').map((t: string) => t.trim());
    const targetUsers = users.filter(u => isOrgAllowed(targetDepts, u.dept));
    const notDoneUsers = targetUsers.filter(u => !responses[`${surveyId}_${u.email}`]?.isDone);
     
    if (notDoneUsers.length === 0) return alert('모든 인원이 배달지 신청을 완료했습니다!');
    
    // 💡 (수정됨) targetEmails 필드를 추가하여 미참여자 이메일 배열을 모달에 넘겨줍니다.
    setNudgeModal({ 
      surveyId, 
      title: survey.title, 
      count: notDoneUsers.length,
      targetEmails: notDoneUsers.map(u => u.email) 
    });
  };

  const handleSavePreview = async () => {
    try {
      const res = await fetch('/api/survey/delivery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // 🚀 수정 포인트: updatedSurvey -> previewModal 로 변경!
        body: JSON.stringify(previewModal) 
      });
      if (res.ok) {
        const savedSurvey = await res.json();
        setSurveys(prev => prev.map(s => s.id === previewModal.id ? savedSurvey : s));
        alert('✅ 기본 정보가 수정되었습니다.');
        setPreviewModal(null);
      }
    } catch (e) {
      console.error(e);
      alert('저장 중 오류가 발생했습니다.');
    }
  };
     
  const handleSaveEdit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
     
    // 🚀 [스키마 싱크]: 불필요한 allowedDepts 계산 로직 제거. (대상 부서는 target 필드 하나로 관리됨)
    const finalEditData = { 
      ...editModal, 
      endTime: editModal.endTime || '23:59', 
      isAnonymous: editModal.isAnonymous === true || editModal.isAnonymous === 'true'
    };
     
    try {
      const res = await fetch('/api/survey/delivery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(finalEditData)
      });
      
      if (res.ok) {
        const savedSurvey = await res.json();
        setSurveys(prev => {
          const exists = prev.find(s => s.id === savedSurvey.id || s.id === editModal.id);
          if (exists) {
            return prev.map(s => (s.id === savedSurvey.id || s.id === editModal.id) ? savedSurvey : s);
          } else {
            return [...prev, savedSurvey];
          }
        });
        alert('✅ 배달 공고가 성공적으로 저장되었습니다.');
        setEditModal(null);
      } else {
        alert('서버 저장에 실패했습니다.');
      }
    } catch (e) {
      console.error(e);
      alert('네트워크 오류가 발생했습니다.');
    }
  };
     
  const handleMatrixFilter = (surveyId: string, type: 'DONE' | 'NOT_DONE') => {
    setMatrixUserFilter({ surveyId, type });
    setCollapsedDepts(new Set());
  };
     
const toggleApprove = async (surveyId: string, userEmail: string) => {
  const cellKey = `${surveyId}_${userEmail}`;
  const resp = responses[cellKey];
  if (!resp) return;
     
  const today = getKSTDateString();
  const isCurrentlyApproved = resp.isApproved || false;
   
  if (isCurrentlyApproved) {
    const msg = prompt('해당 신청의 승인을 취소하시겠습니까?\n직원에게 전달할 취소 사유를 입력해주세요. (예: 주소지 불명확, 품목 품절 등)');
    if (!msg) return;
   
    try {
      const res = await fetch('/api/survey/delivery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'CANCEL', surveyId, userEmail, feedbackMsg: msg })
      });
     
      if (res.ok) {
        setResponses(prev => ({
          ...prev,
          [cellKey]: {
            ...prev[cellKey],
            isApproved: false,
            approvedAt: null,
            feedbackMsg: msg,
            feedbackAt: today,
            isRevoked: true
          }
        }));
        alert('승인이 취소되었으며, 해당 직원에게 보완 필요(승인취소) 알림이 전송되었습니다.');
      }
    } catch (e) {
      console.error(e);
    }
  } else {
    if (!confirm('해당 직원의 신청을 승인하시겠습니까?\n승인 시 직원은 더 이상 정보를 수정할 수 없습니다.')) return;
   
    try {
      const res = await fetch('/api/survey/delivery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'APPROVE', surveyId, userEmail })
      });
     
      if (res.ok) {
        setResponses(prev => ({
          ...prev,
          [cellKey]: {
            ...prev[cellKey],
            isApproved: true,
            approvedAt: today,
            isRevoked: false
          }
        }));
      }
    } catch (e) {
      console.error(e);
    }
  }
};
     
const handleSendFeedback = async (surveyId: string, userEmail: string) => {
  const msg = prompt('신청자에게 보낼 보완 요청 사유를 입력해주세요.\n(예: 상세 주소지 동/호수 누락, 연락처 오기재 등)');
  if (!msg) return;
   
  const today = getKSTDateString();
   
  try {
    const res = await fetch('/api/survey/delivery', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'FEEDBACK', surveyId, userEmail, feedbackMsg: msg })
    });
     
    if (res.ok) {
      setResponses(prev => ({
        ...prev,
        [`${surveyId}_${userEmail}`]: {
          ...prev[`${surveyId}_${userEmail}`],
          feedbackAt: today,
          feedbackMsg: msg,
          isApproved: false,
          approvedAt: null
        }
      }));
      alert('✅ 보완 요청 알림이 직원의 대시보드로 전송되었습니다.');
    }
  } catch (e) {
    console.error(e);
  }
};
     
const handleExportAnalysisAll = () => {
  if (selectedCellKeys.size === 0) return alert('현황 보드 표 내부에서 내보낼 항목을 체크해주세요.');
   
  const wb = XLSX.utils.book_new();
  const recordsBySurvey: Record<string, any[]> = {};
   
  selectedCellKeys.forEach(key => {
    const [surveyId, userEmail] = key.split('_');
    const survey = surveys.find(s => s.id === surveyId);
    const user = users.find(u => u.email === userEmail);
    const resp = responses[key];
    if (survey && user && resp) {
      if (!recordsBySurvey[surveyId]) recordsBySurvey[surveyId] = [];
      recordsBySurvey[surveyId].push({ user, resp, survey });
    }
  });
   
  let appendCount = 0;
  Object.entries(recordsBySurvey).forEach(([surveyId, items]) => {
    const survey = items[0].survey;
    
    let questions = [];
    try {
      questions = typeof survey.questions === 'string' 
        ? JSON.parse(survey.questions) 
        : (survey.questions || []);
    } catch (e) {
      console.error("문항 데이터 파싱 실패:", e);
    }
    if (questions.length === 0) questions = [{ id: 'dq1', title: '1. 배송 정보' }];
   
    const deptRow = ['제출조직(부서)', ...items.map(i => survey.isAnonymous ? '(익명처리됨)' : i.user.dept)];
    const nameRow = ['신청자이름', ...items.map(i => survey.isAnonymous ? '(익명)' : i.user.name)];
    const reqDateRow = ['확인요청일(신청일)', ...items.map(i => i.resp.date || '-')];
    const appDateRow = ['확인완료일(승인일)', ...items.map(i => i.resp.approvedAt || '미승인')];
   
    const contentRows = questions.map((q: any) => {
      const rowData = [q.title];
      items.forEach(i => {
        const isAnon = survey.isAnonymous === true || survey.isAnonymous === 'true';
        const ans = i.resp.answers || {};
        
        if (isAnon) {
          rowData.push('(익명 처리됨)');
        } else if (q.type === 'SEARCH_ADDRESS') {
          const zip = ans[`${q.id}_zip`] || ans[q.id]?.zipCode;
          const road = ans[`${q.id}_road`] || ans[q.id]?.roadAddress;
          const detail = ans[`${q.id}_detail`] || ans[q.id]?.detailAddress;
          if (zip || road) {
            rowData.push(`[${zip || ''}] ${road || ''} ${detail || ''}`);
          } else {
            rowData.push('(미입력)');
          }
        } else {
          const val = ans[q.id];
          if (!val) {
            rowData.push('(미입력)');
          } else {
            rowData.push(Array.isArray(val) ? val.join(', ') : (val.fileName ? `[첨부파일] ${val.fileName}` : val));
          }
        }
      });
      return rowData;
    });
   
    const ws = XLSX.utils.aoa_to_sheet([deptRow, nameRow, reqDateRow, appDateRow, ...contentRows]);
   
    let safeTitle = survey.title.replace(/[\\/?*\[\]:]/g, '_').substring(0, 30);
    if (!safeTitle.trim()) safeTitle = `Survey_${surveyId}`;
   
    XLSX.utils.book_append_sheet(wb, ws, safeTitle);
    appendCount++;
  });
   
  if (appendCount === 0) {
    return alert('추출할 데이터가 존재하지 않습니다. 체크박스를 확인해주세요.');
  }
   
  XLSX.writeFile(wb, `[선택배달명세_엑셀추출]_${todayStr}.xlsx`);
};
     
const handleDownloadZipAll = async () => {
  const zip = new JSZip();
  let hasData = false;
   
  const currentSurveys = deliveryTab === 'ALWAYS'
    ? surveys.filter(s => s.deliveryType === 'ALWAYS')
    : surveys.filter(s => s.deliveryType === 'PERIOD');
   
  for (const survey of currentSurveys) {
    const targetDepts = survey.target.split(',').map((t: string) => t.trim());
    
    let storedQuestions = [];
    try {
      storedQuestions = typeof survey.questions === 'string' 
        ? JSON.parse(survey.questions) 
        : (survey.questions || []);
    } catch (e) {
      console.error("문항 데이터 파싱 실패:", e);
    }
   
    const targetUsers = users.filter(user => {
      const isAllowed = isOrgAllowed(targetDepts, user.dept);
      const isDone = responses[`${survey.id}_${user.email}`]?.isDone;
      const isSelected = deliveryTab === 'ALWAYS' ? selectedCellKeys.has(`${survey.id}_${user.email}`) : true;
      return isAllowed && isDone && isSelected;
    });
   
    if (targetUsers.length === 0) continue;
   
    const safeFolderTitle = survey.title.replace(/[/\\?%*:|"<>]/g, '-');
    const folder = zip.folder(safeFolderTitle);
   
    targetUsers.forEach((user) => {
      const resp = responses[`${survey.id}_${user.email}`];
      hasData = true;
      
      const identifier = survey.isAnonymous ? `익명참여자_${Math.random().toString(36).substring(2, 6)}` : `${user.dept}_${user.name}`;
   
      let content = `■ 공고명: ${survey.title}\n■ 신청자: ${survey.isAnonymous ? '(익명 처리됨)' : user.dept + ' ' + user.name}\n■ 제출일: ${resp.date}\n--------------------------\n\n`;
      const isAnon = survey.isAnonymous === true || survey.isAnonymous === 'true';
      
      storedQuestions.forEach((q: any, i: number) => {
        content += `Q${i + 1}. ${q.title}\n`;
        
        if (isAnon) {
          content += `A. (익명 처리됨)\n\n`;
        } else if (q.type === 'SEARCH_ADDRESS') {
          const zipCode = resp.answers[`${q.id}_zip`] || resp.answers[q.id]?.zipCode;
          const roadAddress = resp.answers[`${q.id}_road`] || resp.answers[q.id]?.roadAddress;
          const detailAddress = resp.answers[`${q.id}_detail`] || resp.answers[q.id]?.detailAddress;
   
          if (zipCode || roadAddress) {
            content += `A. [${zipCode || ''}] ${roadAddress || ''} ${detailAddress || ''}\n\n`;
          } else {
            content += `A. 미입력\n\n`;
          }
        } else {
          const ans = resp.answers[q.id];
          content += `A. ${ans ? (Array.isArray(ans) ? ans.join(', ') : (ans.fileName || ans)) : '미입력'}\n\n`;
        }
      });
      folder?.file(`${identifier}_배송스펙.txt`, "\ufeff" + content);
    });
  }
   
  if (!hasData) return alert('다운로드할 명세 데이터가 없습니다.');
  const content = await zip.generateAsync({ type: "blob" });
  saveAs(content, `[배달명세모음]_${todayStr}.zip`);
};
     
  const handleToggleColumnAll = (surveyId: string, isChecked: boolean) => {
    const next = new Set(selectedCellKeys);
    const survey = surveys.find(s => s.id === surveyId);
    if (!survey) return;
     
    const targetDepts = survey.target.split(',').map((t: string) => t.trim());
    users.forEach(user => {
      if (isOrgAllowed(targetDepts, user.dept)) {
        const cellKey = `${surveyId}_${user.email}`;
        if (responses[cellKey]?.isDone) {
          if (isChecked) next.add(cellKey);
          else next.delete(cellKey);
        }
      }
    });
    setSelectedCellKeys(next);
  };
     
  if (loading) return <div className="p-10 font-black text-teal-400 animate-pulse text-center tracking-widest text-2xl mt-20">인프라 동기화 중...</div>;
     
  return (
    <div className="w-full max-w-[1750px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in text-[11px]">
      
      {/* 🚀 1. 배송 관리자 통제실 배너 (소모품/일반조사 관리자와 100% 에메랄드 테마 동기화) */}
      <div className="w-full bg-gradient-to-r from-emerald-900 to-teal-900 p-6 rounded-[2.5rem] text-white shadow-xl relative overflow-hidden flex flex-col justify-center min-h-[140px]">
        <div className="relative z-10 flex justify-between items-end w-full">
          <div>
            <h3 className="text-[10px] font-black uppercase tracking-widest text-emerald-400 mb-3">
              DELIVERY SURVEY HUB
            </h3>
            <h1 className="text-2xl font-black tracking-tight text-white leading-none">
              배달 복지 신청 관리 센터
            </h1>
            <p className="text-emerald-100/90 text-xs font-semibold mt-4 opacity-90">
              상시/기간제 배달 복지 신청 공고 및 부서별 접수 현황을 통합 모니터링합니다.
            </p>
          </div>
        </div>
        <div className="absolute right-10 top-1/2 -translate-y-1/2 text-8xl opacity-10 select-none pointer-events-none">
          🚚
        </div>
      </div>

      {/* 🚀 2. 배송 관리자 전용 동적 탭 네비게이션 (자석 활성화 핏) */}
      <div className="flex gap-1.5 bg-slate-200/60 p-1.5 rounded-2xl border border-slate-200 shadow-inner w-full max-w-2xl mt-4">
        {[
          { name: '📋 상시/기간 배달 신청 현황', path: '/survey/delivery/admin/active-surveys', exact: true },
          { name: '🗂️ 배송조사 결과 이력 관리', path: '/survey/delivery/admin/history', exact: false },
        ].map((tab) => {
          // 메인 주소는 완벽 일치(exact), 이력 주소는 startsWith로 유연하게 활성화 체크
          const isActive = tab.exact ? pathname === tab.path : pathname.startsWith(tab.path);
          return (
            <Link 
              key={tab.path} 
              href={tab.path} 
              className={`flex-1 py-3 text-center text-[11px] font-black rounded-xl transition-all uppercase tracking-tight ${
                isActive 
                  ? 'bg-white text-emerald-700 shadow-sm border border-emerald-200/50 scale-[1.01]' 
                  : 'text-slate-500 hover:text-slate-800 hover:bg-white/40'
              }`}
            >
              {tab.name}
            </Link>
          );
        })}
      </div>
     
      <div className="flex gap-4 w-full">
        <button onClick={() => setSurveyListFilter(surveyListFilter === 'ONGOING' ? 'ALL' : 'ONGOING')} className={`flex-[1.5] p-5 rounded-[2rem] border transition-all flex items-center justify-between ${surveyListFilter === 'ONGOING' ? 'border-teal-400 bg-teal-50 shadow-inner' : 'border-slate-200 bg-white shadow-sm hover:border-teal-300'}`}>
          <div className="flex items-center gap-4">
            <span className="text-3xl bg-white p-3 rounded-2xl shadow-sm border border-slate-100">🚚</span>
            <div className="text-left">
              <p className="text-[10px] font-black text-teal-600 uppercase mb-1">활성화된 배달망</p>
              <p className="text-2xl font-black text-slate-800">{stats.activeCount} <span className="text-sm font-bold text-slate-500">건</span></p>
            </div>
          </div>
        </button>
     
        <button onClick={() => setSurveyListFilter(surveyListFilter === 'CLOSING_TODAY' ? 'ALL' : 'CLOSING_TODAY')} className={`flex-[1.5] p-5 rounded-[2rem] border transition-all flex items-center justify-between ${surveyListFilter === 'CLOSING_TODAY' ? 'border-red-400 bg-red-50 shadow-inner' : 'border-slate-200 bg-white shadow-sm hover:border-red-300'}`}>
          <div className="flex items-center gap-4">
            <span className="text-3xl bg-white p-3 rounded-2xl shadow-sm border border-slate-100">⏰</span>
            <div className="text-left">
              <p className="text-[10px] font-black text-red-600 uppercase mb-1">오늘 마감 조사</p>
              <p className="text-2xl font-black text-slate-800">{stats.closingTodayCount} <span className="text-sm font-bold text-slate-500">건</span></p>
            </div>
          </div>
        </button>
     
        <button onClick={() => setPendingModalType('ALWAYS')} className="flex-[1.2] p-5 rounded-[2rem] border border-pink-200 bg-gradient-to-r from-pink-50 to-white shadow-sm hover:border-pink-400 transition-all flex items-center justify-between">
          <div className="text-left">
            <p className="text-[10px] font-black text-pink-600 uppercase mb-1">상시신청 대기함</p>
            <p className="text-xl font-black text-slate-800">{stats.pendingAlwaysCount} <span className="text-sm font-bold text-slate-500">건</span></p>
          </div>
          <span className="text-xl">💌</span>
        </button>
     
        <button onClick={() => setPendingModalType('PERIOD')} className="flex-[1.2] p-5 rounded-[2rem] border border-amber-200 bg-gradient-to-r from-amber-50 to-white shadow-sm hover:border-amber-400 transition-all flex items-center justify-between">
          <div className="text-left">
            <p className="text-[10px] font-black text-amber-600 uppercase mb-1">기간신청 대기함</p>
            <p className="text-xl font-black text-slate-800">{stats.pendingPeriodCount} <span className="text-sm font-bold text-slate-500">건</span></p>
          </div>
          <span className="text-xl">📅</span>
        </button>
      </div>
     
     
      <div className="flex bg-slate-200 p-1 rounded-xl w-fit gap-1 mb-2 shadow-sm">
        <button onClick={() => { setDeliveryTab('ALL'); setSelectedCellKeys(new Set()); }} className={`px-4 py-1.5 rounded-lg font-black text-[10px] transition-all ${deliveryTab === 'ALL' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>🔄 통합 전체보기</button>
        <button onClick={() => { setDeliveryTab('ALWAYS'); setSelectedCellKeys(new Set()); }} className={`px-4 py-1.5 rounded-lg font-black text-[10px] transition-all ${deliveryTab === 'ALWAYS' ? 'bg-pink-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-800'}`}>🌸 꽃배달서비스 상시신청</button>
        <button onClick={() => { setDeliveryTab('PERIOD'); setSelectedCellKeys(new Set()); }} className={`px-4 py-1.5 rounded-lg font-black text-[10px] transition-all ${deliveryTab === 'PERIOD' ? 'bg-amber-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-800'}`}>⏰ 명절/물품 기간신청</button>
      </div>
     
      <div className="bg-white border border-slate-200 shadow-sm rounded-[2rem] overflow-hidden">
        <div className="p-4 px-6 bg-slate-900 flex justify-between items-center text-white">
          <h3 className="text-[12px] font-black flex items-center gap-2"><span>📢</span> 신청 공지 및 관리 리스트</h3>
          <button onClick={handleAddSurvey} className="px-4 py-2 bg-teal-600 text-white rounded-xl font-black text-[10px] shadow-sm hover:bg-teal-500 transition-all">+ 공지 추가</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left font-medium min-w-[1450px]">

          <thead className="bg-slate-50 text-[10px] text-slate-500 font-black border-b border-slate-200 tracking-tight uppercase">
            <tr>
              <th className="py-3 pl-4 w-10 text-center">NO</th>
              <th className="py-3 px-2 w-20">식별코드</th>
              <th className="py-3 px-2 w-16 text-center text-teal-500">신청분류</th>
              <th className="py-3 px-2 w-16 text-center text-indigo-500">게시번호</th>
              <th className="py-3 px-2 w-20 text-center">게시일</th>
              <th className="py-3 px-2 w-[280px]">공고명</th>
              <th className="py-3 px-2 w-24 text-center">대상 범위</th>
              <th className="py-3 px-2 w-[140px] text-center">운영 신청 기간</th>
              <th className="py-3 px-2 w-16 text-center border-l bg-slate-100/50">참여율</th>
              <th className="py-3 px-2 w-16 text-center bg-blue-50/50 text-blue-600">접수완료</th>
              <th className="py-3 px-2 w-[150px] text-center bg-red-50/50 text-red-600 border-r">미접수인원</th>
              <th className="py-3 px-2 w-16 text-center">공고상태</th>
              <th className="py-3 px-2 w-[145px] text-center border-l border-slate-200 bg-slate-100/30 text-teal-600">게시 제어</th>
              <th className="py-3 pr-4 w-[145px] text-center bg-slate-100/30 text-slate-500">명세 관리</th>
            </tr>
          </thead>
          
          <tbody className="divide-y divide-slate-100 text-[11px]">
            {filteredSurveys.map((s, idx) => {
              const targetDepts = s.target.split(',').map((t: string) => t.trim());
              const targetUsers = users.filter(u => isOrgAllowed(targetDepts, u.dept));
              const done = targetUsers.filter(u => responses[`${s.id}_${u.email}`]?.isDone).length;
              const total = targetUsers.length;
              const notDone = total - done;
              const rate = total > 0 ? Math.round((done / total) * 100) : 0;
              
              // 현재 시간과 마감 시간 정밀 비교
              const now = new Date();
              const deadlineStr = `${s.endDate}T${s.endTime || '23:59'}:00`;
              const deadline = new Date(deadlineStr);
              
              const isTimeOver = s.status === '진행중' && now > deadline;
              const displayStatus = isTimeOver ? '기간종료' : s.status;
   
              return (
                <tr key={s.id} className="hover:bg-teal-50/10 h-14 transition-colors">
                  <td className="py-2 pl-4 text-center text-slate-400 font-bold align-middle">{idx + 1}</td>
                  <td className="py-2 px-2 font-mono font-black text-slate-600 tracking-tighter align-middle">{s.code}</td>
                  <td className="py-2 px-2 text-center align-middle">
                    <span className={`px-1.5 py-0.5 rounded text-[8px] font-black ${s.deliveryType === 'ALWAYS' ? 'bg-pink-100 text-pink-700' : 'bg-amber-100 text-amber-700'}`}>
                      {s.deliveryType === 'ALWAYS' ? '상시' : '기간'}
                    </span>
                  </td>
                  <td className="py-2 px-2 font-black text-center text-indigo-600 text-[12px] align-middle">{s.postNumber}</td>
                  <td className="py-2 px-2 font-mono text-center text-slate-500 tracking-tighter whitespace-nowrap align-middle">{s.postDate === '-' ? '' : s.postDate}</td>
                  
                  <td className="py-2 px-2 align-middle">
                    <button onClick={() => setPreviewModal(s)} className="font-black text-slate-800 text-[11px] hover:text-teal-600 hover:underline text-left line-clamp-1">{s.title}</button>
                    {/* 💡 (선택형 등) 유형 삭제 완료 */}
                  </td>
                  
                  <td className="py-2 px-2 font-bold text-slate-600 text-center align-middle">
                    <div className="text-[10px] leading-tight cursor-help truncate w-20 mx-auto" title={s.target}>
                      {s.target === '전사' ? '전사' : <span className="underline decoration-dashed decoration-slate-300">{s.target.split(',').length}개 부서 지정</span>}
                    </div>
                  </td>
                  
                  <td className="py-2 px-2 text-slate-500 tracking-tighter text-center text-[9px] whitespace-nowrap align-middle">
                    <div>{s.startDate} ~</div>
                    {/* 💡 공고상태에 있던 마감시간을 이곳(운영 신청 기간)으로 이동 완료 */}
                    <div className={isTimeOver ? 'text-red-500 font-black' : ''}>{s.endDate} <span className="text-[8px]">({s.endTime || '23:59'})</span></div>
                  </td>
                  
                  <td className="py-2 px-2 text-center font-black text-slate-700 border-l bg-slate-50/30 align-middle">{rate}%</td>
                  <td className="py-2 px-2 text-center bg-blue-50/30 align-middle">
                    <button onClick={() => handleMatrixFilter(s.id, 'DONE')} className="text-blue-600 font-black hover:underline">{done}명</button>
                  </td>
                  <td className="py-2 px-2 text-center bg-red-50/30 border-r align-middle">
                    <div className="flex items-center justify-center gap-2 w-full flex-wrap">
                      <button onClick={() => handleMatrixFilter(s.id, 'NOT_DONE')} className="text-red-500 font-black hover:underline shrink-0 whitespace-nowrap">{notDone}명</button>
                      {s.status === '진행중' && notDone > 0 && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => handleNudge(s.id)} className="px-1.5 py-0.5 bg-white border border-red-200 text-red-600 rounded text-[9px] font-black hover:bg-red-50 transition-colors shadow-sm whitespace-nowrap">🔔독촉</button>
                          {!(s.isAnonymous === true || s.isAnonymous === 'true') && (
                            <button onClick={() => handleCopyUnsubmittedEmails(s)} className="px-1.5 py-0.5 bg-white border border-slate-200 text-slate-600 rounded text-[9px] font-black hover:bg-slate-50 transition-colors shadow-sm whitespace-nowrap">📧메일추출</button>
                          )}
                        </div>
                      )}
                    </div>
                  </td>
                  
                  <td className="py-2 px-2 text-center align-middle">
                    <span className={`px-2 py-1 rounded font-black text-[9px] whitespace-nowrap ${isTimeOver ? 'bg-red-100 text-red-700 animate-pulse' : getStatusBadge(displayStatus)}`}>
                      {displayStatus}
                    </span>
                    {/* 💡 공고상태 밑에 있던 마감시간 텍스트 삭제 완료 */}
                  </td>
                  
                  <td className="py-2 px-2 align-middle border-l border-slate-200 bg-slate-50/50">
                    <div className="flex items-center justify-center gap-1 w-full">
                      <button onClick={() => handleStatusChange(s.id, 'UP')} disabled={s.status === '진행중' || s.status === '완료'} className={`flex-1 py-1.5 rounded text-[9px] font-black whitespace-nowrap transition-all shadow-sm border ${s.status === '게시전' || s.status === '게시중단' ? 'bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700' : 'bg-slate-50 border-slate-200 text-slate-300 cursor-not-allowed'}`}>게시</button>
                      <button onClick={() => handleStatusChange(s.id, 'DOWN')} disabled={s.status !== '진행중'} className={`flex-1 py-1.5 rounded text-[9px] font-black whitespace-nowrap transition-all shadow-sm border ${s.status === '진행중' ? 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100' : 'bg-slate-50 border-slate-200 text-slate-300 cursor-not-allowed'}`}>중단</button>
                      <button onClick={() => handleStatusChange(s.id, 'FORCE_COMPLETE')} disabled={s.status !== '진행중'} className={`flex-1 py-1.5 rounded text-[9px] font-black whitespace-nowrap transition-all shadow-sm border ${s.status === '진행중' ? 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700' : 'bg-slate-50 border-slate-200 text-slate-300 cursor-not-allowed'}`}>마감</button>
                    </div>
                  </td>
                  <td className="py-2 pr-4 align-middle bg-slate-50/50">
                    <div className="flex items-center justify-center gap-1 w-full">
                      <button onClick={() => setEditModal(s)} disabled={s.status === '진행중' || s.status === '완료'} className={`flex-1 py-1.5 rounded text-[9px] font-black whitespace-nowrap transition-all shadow-sm border ${s.status === '게시전' || s.status === '게시중단' ? 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100' : 'bg-slate-50 border-slate-200 text-slate-300 cursor-not-allowed'}`}>수정</button>
                      <button onClick={() => handleDeleteSurvey(s.id)} disabled={s.hasBeenPublished} className={`flex-1 py-1.5 rounded text-[9px] font-black whitespace-nowrap transition-all shadow-sm border ${!s.hasBeenPublished ? 'bg-white border-red-200 text-red-500 hover:bg-red-50' : 'bg-slate-50 border-slate-200 text-slate-300 cursor-not-allowed'}`}>삭제</button>
                      <button onClick={() => handleStatusChange(s.id, 'ARCHIVE')} disabled={s.status !== '완료'} className={`flex-1 py-1.5 rounded text-[9px] font-black whitespace-nowrap transition-all shadow-sm border ${s.status === '완료' ? 'bg-slate-800 text-white border-slate-800 hover:bg-slate-900' : 'bg-slate-50 border-slate-200 text-slate-300 cursor-not-allowed'}`}>보관함이동</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>

          </table>
        </div>
      </div>
     
      {deliveryTab !== 'ALL' && (
        <div className="bg-white border border-slate-200 shadow-sm rounded-2xl overflow-hidden mt-6 animate-fade-in-up">
          <div className="p-4 px-6 bg-slate-900 flex justify-between items-center text-white">
            <div className="flex items-center gap-3">
              <h3 className="text-[12px] font-black flex items-center gap-2">
                <span>🗂️</span> 부서 및 직원별 주소지/물품 접수 현황 보드
              </h3>
              {selectedCellKeys.size > 0 && (
                <span className="bg-amber-500 text-slate-900 px-2 py-0.5 rounded text-[9px] font-black animate-bounce">
                  {selectedCellKeys.size}개 항목 선택됨
                </span>
              )}
            </div>
     
            <div className="flex gap-2">
              <button onClick={handleDownloadZipAll} className="px-4 py-2 bg-indigo-600 rounded-lg text-[10px] font-black shadow-sm hover:bg-indigo-500 transition-all flex items-center gap-1.5">
                <span>📥</span> ZIP 패키지 다운로드
              </button>
              <button onClick={handleExportAnalysisAll} className="px-4 py-2 bg-emerald-600 rounded-lg text-[10px] font-black shadow-sm hover:bg-emerald-500 transition-all flex items-center gap-1.5">
                <span>📈</span> 배달 대장 엑셀 다운
              </button>
            </div>
          </div>
     
          <div className="overflow-x-auto max-h-[600px] scrollbar-thin">
            <table className="w-full text-left border-collapse min-w-[1200px]">
              <thead className="sticky top-0 z-20 bg-white shadow-sm">
                <tr className="border-b-2 border-slate-300">
                  <th className="py-2 pl-6 w-48 bg-slate-50 font-black text-slate-500 text-[9px] align-bottom">
                    <div className="uppercase mb-1">소속 부서 / 이름</div>
                    <div className="flex gap-2 text-[8px] text-teal-600 font-bold">
                      <button onClick={collapseAll} className="hover:underline">전체 접기</button> <span className="text-slate-300">|</span> <button onClick={expandAll} className="hover:underline">전체 펼치기</button>
                    </div>
                  </th>
                  {filteredSurveys.map(s => {
                    const targetDepts = s.target.split(',').map((t: string) => t.trim());
                    const columnUsers = users.filter(u => isOrgAllowed(targetDepts, u.dept) && responses[`${s.id}_${u.email}`]?.isDone);
                    const isColumnAllChecked = columnUsers.length > 0 && columnUsers.every(u => selectedCellKeys.has(`${s.id}_${u.email}`));
     
                    return (
                      <th key={s.id} className="p-0 border-l border-slate-200 bg-white align-top min-w-[320px]">
                        <div className="p-2 border-b border-slate-100 flex items-center justify-center bg-slate-50/30">
                          <label className="flex items-center gap-1.5 cursor-pointer group">
                            <input type="checkbox" checked={isColumnAllChecked} onChange={(e) => handleToggleColumnAll(s.id, e.target.checked)} className="w-3.5 h-3.5 accent-indigo-600 cursor-pointer rounded" />
                            <div className="text-center">
                              <span className="font-black text-slate-800 text-[10px] leading-tight group-hover:text-indigo-600">[{s.code}]</span><br />
                              <span className="line-clamp-1 text-slate-500 text-[9px] group-hover:text-indigo-500 mt-0.5">{s.title}</span>
                            </div>
                          </label>
                        </div>
                        <div className="grid grid-cols-[30px_1fr_1fr_1fr_70px] text-[9px] font-black text-slate-500 bg-slate-50 border-b border-slate-100">
                          <div className="py-1.5 text-center border-r border-slate-100">선택</div>
                          <div className="py-1.5 text-center border-r border-slate-100 text-indigo-600">사용자신청</div>
                          <div className="py-1.5 text-center border-r border-slate-100 text-amber-600">관리자의견전송</div>
                          <div className="py-1.5 text-center border-r border-slate-100 text-emerald-600">확인완료</div>
                          <div className="py-1.5 text-center">관리</div>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {Object.entries(groupedUsers).map(([dept, deptUsers]) => (
                  <Fragment key={dept}>
                    <tr className="bg-slate-50/80 cursor-pointer hover:bg-slate-100 border-b border-white" onClick={() => toggleDept(dept)}>
                      <td className="py-2 pl-6 font-black text-slate-700 flex items-center gap-2 text-[11px]"><span className="text-[8px] opacity-60">{collapsedDepts.has(dept) ? '▶' : '▼'}</span>{dept} <span className="text-[9px] text-slate-400 ml-1">{deptUsers.length}명</span></td>
                      {filteredSurveys.map(s => {
                        const targetDepts = s.target.split(',').map((t: string) => t.trim());
                        if (!isOrgAllowed(targetDepts, dept)) return <td key={`ds-${s.id}`} className="py-2 border-l border-slate-200 text-center bg-slate-100/30 text-[10px] font-black text-slate-300">-</td>;
                        const dDone = deptUsers.filter(u => responses[`${s.id}_${u.email}`]?.isDone).length;
                        const dTotal = deptUsers.length;
                        return <td key={`ds-${s.id}`} className="py-2 border-l border-slate-200 text-center bg-slate-100/30"><div className="text-[9px] font-bold text-slate-600"><span className="text-teal-600 font-black">{dDone}명</span> / {dTotal}명</div></td>
                      })}
                    </tr>
                    {!collapsedDepts.has(dept) && deptUsers.map(user => {
                      if (matrixUserFilter.type === 'DONE' && matrixUserFilter.surveyId && !responses[`${matrixUserFilter.surveyId}_${user.email}`]?.isDone) return null;
                      if (matrixUserFilter.type === 'NOT_DONE' && matrixUserFilter.surveyId && responses[`${matrixUserFilter.surveyId}_${user.email}`]?.isDone) return null;
     
                      return (
                        <tr key={user.id} className="hover:bg-slate-50 transition-colors border-b border-slate-50 h-12">
                          <td className="py-2 pl-12 font-bold text-slate-700 flex items-center gap-2 border-r border-slate-50 text-[10px]"><div className="w-1 h-1 rounded-full bg-slate-300"></div>{user.name} <span className="text-[8px] text-slate-400 font-mono">{user.email.split('@')[0]}</span></td>
                          {filteredSurveys.map(s => {
                            const targetDepts = s.target.split(',').map((t: string) => t.trim());
                            if (!isOrgAllowed(targetDepts, user.dept)) return <td key={`${s.id}-${user.id}`} className="py-2 border-l border-slate-100 text-center text-[10px] font-black text-slate-300">-</td>;
     
                            const cellKey = `${s.id}_${user.email}`;
                            const resp = responses[cellKey];
                            const hasFile = resp?.answers && Object.values(resp.answers).some((a: any) => a && a.fileName);
     
                            return (
                              <td key={`${s.id}-${user.id}`} className="p-0 border-l border-slate-100 align-middle h-full">
                                {resp?.isDone ? (
                                  <div className="grid grid-cols-[30px_1fr_1fr_1fr_70px] h-full min-h-[44px] items-center text-[10px] font-bold divide-x divide-slate-100 hover:bg-slate-50/50">
                                    <div className="flex items-center justify-center h-full">
                                      <input
                                        type="checkbox"
                                        checked={selectedCellKeys.has(cellKey)}
                                        onChange={(e) => {
                                          const next = new Set(selectedCellKeys);
                                          if (e.target.checked) next.add(cellKey); else next.delete(cellKey);
                                          setSelectedCellKeys(next);
                                        }}
                                        className="w-3.5 h-3.5 accent-indigo-600 rounded cursor-pointer"
                                      />
                                    </div>
                                    <div className="flex flex-col items-center justify-center h-full gap-1 p-1 text-center">
                                      {(() => {
                                        // 🚀 [로직 픽스]: API가 최초 제출을 1로 기록하므로, 2이상일 때를 '수정'으로 판별
                                        const revCount = resp.revisionCount || 1;
                                        const isModified = revCount > 1;
                                        const submitLabel = isModified ? `${revCount - 1}차수정(${resp.date})` : `최초제출(${resp.date})`;
                                        const submitColor = isModified ? 'text-red-600 font-extrabold' : 'text-slate-500 font-medium';
     
                                        return (
                                          <span className={`${submitColor} cursor-pointer hover:underline text-[9px] tracking-tight`} onClick={() => {
                                            let storedQuestions = [];
                                            try {
                                              storedQuestions = typeof s.questions === 'string' 
                                                ? JSON.parse(s.questions) 
                                                : (s.questions || []);
                                            } catch (e) {
                                              console.error("문항 파싱 오류:", e);
                                            }
                                            
                                            // 🚀 [정합성 가드 1]: 답변이 문자열로 묶여있으면 풀기
                                            let parsedAnswers = resp.answers || {};
                                            if (typeof parsedAnswers === 'string') {
                                              try { parsedAnswers = JSON.parse(parsedAnswers); } catch(e) {}
                                            }
                                            
                                            // 🚀 [정합성 가드 2, 3]: 섹션 제외하고 주소 규격 맞춰서 뽑아오기
                                            const answersContent = storedQuestions
                                              .filter((q: any) => q.type !== 'SECTION') 
                                              .map((q: any) => {
                                                let aStr = '미입력';
                                                
                                                if (q.type === 'SEARCH_ADDRESS') {
                                                  const zip = parsedAnswers[`${q.id}_zip`] || parsedAnswers[q.id]?.zipCode;
                                                  const road = parsedAnswers[`${q.id}_road`] || parsedAnswers[q.id]?.roadAddress;
                                                  const detail = parsedAnswers[`${q.id}_detail`] || parsedAnswers[q.id]?.detailAddress;
                                                  if (zip || road) aStr = `[${zip || ''}] ${road || ''} ${detail || ''}`;
                                                } else {
                                                  const a = parsedAnswers[q.id];
                                                  if (a !== undefined && a !== null && a !== '') {
                                                    aStr = Array.isArray(a) ? a.join(', ') : (a.fileName || a);
                                                  }
                                                }
                                                return `• ${q.title}\n  ➔ ${aStr}`;
                                              }).join('\n\n');
                                           
                                            alert(`📋 [${user.name} 직원 신청서]\n\n${answersContent || '제출된 명세 내용이 없습니다.'}`);
                                          }}>
                                            {submitLabel}
                                          </span>
                                        );
                                      })()}
     
                                      {hasFile && (
                                        <button onClick={(e) => {
                                          e.stopPropagation();
                                          const fileAns = Object.values(resp.answers || {}).find((a: any) => a && a.fileName);
                                          if (fileAns && (fileAns as any).fileData) fetch((fileAns as any).fileData).then(r => r.blob()).then(blob => saveAs(blob, (fileAns as any).fileName));
                                        }} className="text-[8px] font-black px-1.5 py-0.5 rounded bg-teal-50 text-teal-600 border border-teal-200 hover:bg-teal-100 shadow-sm">📂 파일받기</button>
                                      )}
                                    </div>
                                    <div
                                      className={`flex items-center justify-center font-mono h-full text-[9px] ${resp.isRevoked ? 'text-red-600 font-black cursor-pointer hover:underline' : resp.feedbackMsg ? 'text-amber-600 cursor-pointer hover:underline' : 'text-slate-300'}`}
                                      onClick={() => {
                                        if (resp.feedbackMsg) alert(`💡 [관리자 ${resp.isRevoked ? '승인 취소' : '보완 요청'} 사유]\n\n일자: ${resp.feedbackAt}\n사유: ${resp.feedbackMsg}`);
                                      }}
                                    >
                                      {resp.feedbackAt || '-'}
                                    </div>
                                    <div className="flex items-center justify-center font-mono text-emerald-600 h-full text-[9px]">
                                      {resp.isApproved ? resp.approvedAt : <span className="text-slate-300">-</span>}
                                    </div>
                                    <div className="flex flex-col justify-center gap-1 p-1 h-full">
                                      <button
                                        onClick={() => handleSendFeedback(s.id, user.email)}
                                        disabled={resp.isApproved}
                                        className={`px-1.5 py-0.5 rounded text-[8px] font-black transition-all shadow-sm border ${resp.isApproved ? 'bg-slate-50 border-slate-200 text-slate-300 cursor-not-allowed' : 'bg-white border-amber-200 text-amber-600 hover:bg-amber-50'}`}
                                      >
                                        보완 요청
                                      </button>
                                      <button
                                        onClick={() => toggleApprove(s.id, user.email)}
                                        className={`px-1.5 py-0.5 rounded text-[8px] font-black transition-all shadow-sm border ${resp.isApproved ? 'bg-slate-200 text-slate-500 border-slate-300 hover:bg-slate-300' : 'bg-slate-800 text-white border-slate-800 hover:bg-slate-900'}`}
                                      >
                                        {resp.isApproved ? '승인 취소' : '승인 처리'}
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-center h-full min-h-[44px]">
                                    <span className="text-[9px] font-black text-slate-300">미신청</span>
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
     
{/* 🚀 상시/기간 결재 대기함 모달 */}
{pendingModalType && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[300] flex items-center justify-center p-4">
          <div className="bg-white w-[900px] rounded-[2rem] overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
            <div className={`p-6 ${pendingModalType === 'ALWAYS' ? 'bg-pink-600' : 'bg-amber-500'} text-white flex justify-between items-center`}>
              <div>
                <h3 className="font-black text-lg flex items-center gap-2">
                  {pendingModalType === 'ALWAYS' ? '💌 상시 신청 결재 대기함' : '📅 기간 신청 결재 대기함'}
                </h3>
                <p className={`text-xs ${pendingModalType === 'ALWAYS' ? 'text-pink-200' : 'text-amber-100'} mt-1`}>
                  총 {pendingModalType === 'ALWAYS' ? pendingAlwaysApprovals.length : pendingPeriodApprovals.length}건의 승인 대기 내역이 있습니다.
                </p>
              </div>
              <button onClick={() => setPendingModalType(null)} className="text-2xl opacity-80 hover:opacity-100">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto bg-slate-50 p-6">
              {(pendingModalType === 'ALWAYS' ? pendingAlwaysApprovals : pendingPeriodApprovals).length === 0 ? (
                <div className="py-20 text-center text-slate-400 font-black">대기 중인 결재 내역이 없습니다.</div>
              ) : (
                <div className="space-y-4">
                  {(pendingModalType === 'ALWAYS' ? pendingAlwaysApprovals : pendingPeriodApprovals).map((item, idx) => (
                    <div key={idx} className={`bg-white p-5 border ${pendingModalType === 'ALWAYS' ? 'border-pink-100' : 'border-amber-100'} rounded-2xl shadow-sm flex items-center justify-between`}>
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`${pendingModalType === 'ALWAYS' ? 'bg-pink-100 text-pink-600' : 'bg-amber-100 text-amber-700'} px-2 py-0.5 rounded text-[9px] font-black`}>확인요청</span>
                          <span className="font-black text-slate-800 text-[13px]">
                            {item.user.name} 
                            <span className="text-[10px] text-slate-400 font-normal">({item.user.dept})</span>
                          </span>
                        </div>
                        <p className="font-bold text-slate-600 text-[11px] mb-1">[{item.survey.code}] {item.survey.title}</p>
                        <p className="text-[10px] font-mono text-slate-400">신청일시: {item.resp.fullDate}</p>
                      </div>
                      <div className="flex gap-2">
                      <button 
    onClick={() => {
      let storedQuestions = [];
      try {
        storedQuestions = typeof item.survey.questions === 'string' 
          ? JSON.parse(item.survey.questions) 
          : (item.survey.questions || []);
      } catch (e) {
        console.error("문항 파싱 오류:", e);
      }
      
      // 🚀 1. 답변 데이터가 문자열(String)로 직렬화되어 있을 경우를 대비해 확실히 JSON으로 풂
      let parsedAnswers = item.resp.answers || {};
      if (typeof parsedAnswers === 'string') {
        try { parsedAnswers = JSON.parse(parsedAnswers); } catch(e) {}
      }
      
      const answersContent = storedQuestions
        .filter((q: any) => q.type !== 'SECTION') // 🚀 2. 섹션(단순 텍스트 안내문) 제외하고 실제 응답이 있는 문항만 추출
        .map((q: any) => {
          let aStr = '미입력';
          
          if (q.type === 'SEARCH_ADDRESS') {
            // 🚀 3. 일반/배달 2가지 포맷(플랫, 중첩) 모두에서 주소를 확실히 건져냄
            const zip = parsedAnswers[`${q.id}_zip`] || parsedAnswers[q.id]?.zipCode;
            const road = parsedAnswers[`${q.id}_road`] || parsedAnswers[q.id]?.roadAddress;
            const detail = parsedAnswers[`${q.id}_detail`] || parsedAnswers[q.id]?.detailAddress;
            if (zip || road) aStr = `[${zip || ''}] ${road || ''} ${detail || ''}`;
          } else {
            const a = parsedAnswers[q.id];
            if (a !== undefined && a !== null && a !== '') {
              aStr = Array.isArray(a) ? a.join(', ') : (a.fileName || a);
            }
          }
          return `• ${q.title}\n  ➔ ${aStr}`;
        }).join('\n\n');
     
      alert(`📋 [${item.user.name} 직원 신청서]\n신청일시: ${item.resp.fullDate}\n\n${answersContent || '제출된 명세 내용이 없습니다.'}`);
    }} 
    className="px-4 py-2 bg-white border border-teal-200 text-teal-600 rounded-xl text-[10px] font-black hover:bg-teal-50 shadow-sm"
  >
    🔍 응답결과 보기
  </button>
  
  <button onClick={() => handleSendFeedback(item.survey.id, item.user.email)} className="px-4 py-2 bg-white border border-amber-200 text-amber-600 rounded-xl text-[10px] font-black hover:bg-amber-50 shadow-sm">보완 요청</button>
  <button onClick={() => toggleApprove(item.survey.id, item.user.email)} className="px-4 py-2 bg-slate-800 text-white rounded-xl text-[10px] font-black hover:bg-black shadow-sm">최종 승인 처리</button>
</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
     
{/* 🚀 수정 모달창 (대표님 원본 코드 복구 및 정제 버전) */}
{editModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[250] flex items-center justify-center p-4" onClick={() => setEditModal(null)}>
          <div className="bg-white w-[500px] rounded-[2rem] overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="p-5 bg-slate-900 text-white flex justify-between items-center">
              <h3 className="font-black text-sm">{editModal.hasBeenPublished ? '배달 공고 설정 메타 정보 수정' : '신규 배달 공고 등록'}</h3>
              <button type="button" onClick={() => setEditModal(null)} className="text-lg">✕</button>
            </div>
            
            <form onSubmit={handleSaveEdit} className="p-6 space-y-4 bg-slate-50 max-h-[85vh] overflow-y-auto">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[9px] font-black text-slate-500 mb-1 block">식별코드</label>
                  <input type="text" value={editModal.code} onChange={e => setEditModal((prev: any) => ({ ...prev, code: e.target.value }))} className="w-full p-2 rounded-lg border text-[11px] font-bold outline-none focus:border-teal-500" />
                </div>
                <div>
                  <label className="text-[9px] font-black text-teal-500 mb-1 block">게시번호</label>
                  <input type="number" value={editModal.postNumber} onChange={e => setEditModal((prev: any) => ({ ...prev, postNumber: Number(e.target.value) }))} className="w-full p-2 rounded-lg border text-[11px] font-black outline-none focus:border-teal-500" />
                </div>
                <div>
                  <label className="text-[9px] font-black text-slate-500 mb-1 block">게시일</label>
                  <input type="date" value={editModal.postDate} onChange={e => setEditModal((prev: any) => ({ ...prev, postDate: e.target.value }))} className="w-full p-2 rounded-lg border text-[11px] font-bold focus:border-teal-500 outline-none" />
                </div>
              </div>
              
              <div>
                <label className="text-[9px] font-black text-slate-500 mb-1 block">배달 서비스 공고 제목</label>
                <input type="text" required value={editModal.title} onChange={e => setEditModal((prev: any) => ({ ...prev, title: e.target.value }))} className="w-full p-2.5 rounded-lg border font-black text-xs outline-none focus:border-teal-500" />
              </div>

              <div>
                <label className="text-[9px] font-black text-slate-500 mb-1 block">상세 설명 (Description)</label>
                <textarea required value={editModal.description || ''} onChange={e => setEditModal((prev: any) => ({...prev, description: e.target.value}))} className="w-full p-2 rounded-lg border text-xs font-medium outline-none focus:border-teal-500 min-h-[60px]" placeholder="배송 일정, 주의사항 등을 기재해주세요." />
              </div>
              
              <div className="grid grid-cols-2 gap-4 border-t border-slate-200 pt-3 mt-1">
                {/* 1. 왼쪽: 신청분류 (상시/기간) */}
                <div>
                  <label className="text-[9px] font-black text-blue-500 mb-1 block">신청분류 (상시/기간)</label>
                  <select value={editModal.deliveryType} onChange={e => setEditModal((prev: any) => ({ ...prev, deliveryType: e.target.value }))} className="w-full p-2 rounded-lg border text-[11px] font-bold outline-none bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500">
                    <option value="ALWAYS">상시 신청</option>
                    <option value="PERIOD">기간 신청</option>
                  </select>
                </div>
                
                {/* 2. 오른쪽: 대상 범위 부서 지정 */}
                <div>
                  <label className="text-[9px] font-black text-slate-500 mb-1 block">대상 범위 부서 지정</label>
                  <select 
                    value={editModal.target === '전사' ? '전사' : '특정'} 
                    onChange={(e) => { 
                      if (e.target.value === '전사') {
                        setEditModal((prev: any) => ({ ...prev, target: '전사' })); 
                      } else {
                        // 'kpcqa' 등 최상위 노드나 첫 번째 부서로 초기화
                        setEditModal((prev: any) => ({ ...prev, target: deptList.filter(d => d !== 'kpcqa')[0] || deptList[0] || '' })); 
                      }
                    }} 
                    className="w-full p-2 rounded-lg border text-[11px] font-bold outline-none focus:border-teal-500 bg-white"
                  >
                    <option value="전사">전사 임직원</option>
                    <option value="특정">특정 부서 한정</option>
                  </select>
                  
                  {editModal.target !== '전사' && (
                    <div className="border bg-white rounded-lg p-2 max-h-24 overflow-y-auto mt-2">
                      {deptList.filter(d => d !== 'kpcqa').map(d => (
                        <label key={d} className="flex items-center gap-2 cursor-pointer p-1 hover:bg-slate-50">
                          <input type="checkbox" checked={editModal.target.includes(d)} onChange={() => toggleTarget(d)} className="accent-teal-600" />
                          <span className="text-[10px] font-bold">{d}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* 3. 하단: 날짜 및 시간 영역 (1줄 3칸으로 예쁘게 정렬) */}
              <div className="grid grid-cols-3 gap-3 pt-2">
                <div>
                  <label className="text-[9px] font-black text-slate-500 mb-1 block">운영 시작일</label>
                  <input type="date" required value={editModal.startDate} onChange={e => setEditModal((prev: any) => ({ ...prev, startDate: e.target.value }))} className="w-full p-2 rounded-lg border text-[11px] font-bold outline-none focus:border-teal-500" />
                </div>
                <div>
                  <label className="text-[9px] font-black text-red-500 mb-1 block">운영 종료일</label>
                  <input type="date" required value={editModal.endDate} onChange={e => setEditModal((prev: any) => ({ ...prev, endDate: e.target.value }))} className="w-full p-2 rounded-lg border text-[11px] font-bold outline-none focus:border-red-500" />
                </div>
                <div>
                  <label className="text-[9px] font-black text-red-500 mb-1 block">마감 시간</label>
                  <input type="time" required value={editModal.endTime || '23:59'} onChange={e => setEditModal((prev: any) => ({ ...prev, endTime: e.target.value }))} className="w-full p-2 rounded-lg border text-[11px] font-bold outline-none focus:border-red-500" />
                </div>
              </div>
              
              <div className="pt-4 flex gap-2 mt-2 border-t border-slate-200">
                <button type="button" onClick={() => setEditModal(null)} className="flex-1 py-2.5 bg-white border rounded-xl font-black text-slate-600 hover:bg-slate-50">취소</button>
                <button type="submit" className="flex-1 py-2.5 bg-teal-600 text-white rounded-xl font-black shadow-md hover:bg-teal-700">정보 저장하기</button>
              </div>
            </form>
          </div>
        </div>
      )}

{/* 🚀 미참여자 독촉 알림 모달 */}
{nudgeModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[250] flex items-center justify-center p-4" onClick={() => setNudgeModal(null)}>
          <div className="bg-white w-[400px] rounded-[2rem] overflow-hidden shadow-2xl flex flex-col animate-fade-in-up" onClick={e => e.stopPropagation()}>
            <div className="p-5 bg-red-50 text-red-600 flex justify-between items-center border-b border-red-100">
              <h3 className="font-black text-sm flex items-center gap-2">🔔 미참여자 독촉 알림 발송</h3>
              <button onClick={() => setNudgeModal(null)} className="text-xl opacity-70 hover:opacity-100">✕</button>
            </div>
            <div className="p-6 text-center space-y-4 bg-white">
              <div className="text-5xl animate-bounce mt-2">🚨</div>
              <div>
                <p className="text-[11px] font-bold text-slate-500 mb-1 line-clamp-1">[{nudgeModal.title}]</p>
                <p className="text-sm font-black text-slate-800 leading-snug mt-3">
                  아직 명세를 제출하지 않은 <span className="text-red-600 text-lg">{nudgeModal.count}명</span>에게<br/>
                  제출 독촉(리마인드) 알림을 전송하시겠습니까?
                </p>
                <p className="text-[9px] text-slate-400 mt-2 font-bold">전송 시 해당 임직원의 대시보드와 메일로 알림이 갑니다.</p>
              </div>
              <div className="pt-5 flex gap-2 border-t border-slate-100 mt-4">
              <button 
                  onClick={async () => {
                    try {
                      const res = await fetch('/api/survey/delivery', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                          action: 'NUDGE', 
                          surveyId: nudgeModal.surveyId,
                          title: nudgeModal.title,
                          targetEmails: nudgeModal.targetEmails 
                        })
                      });
                      
                      if (res.ok) {
                        // 🚀 [상태 동기화 추가]: 독촉한 내역을 로컬 state에도 즉시 반영하여 직원 화면과 매끄럽게 연동되도록 함
                        setSurveys(prev => prev.map(s => 
                          s.id === nudgeModal.surveyId 
                            ? { ...s, nudgedUsers: nudgeModal.targetEmails } 
                            : s
                        ));
                        alert(`✅ 미참여자 ${nudgeModal.count}명에게 독촉 알림이 전송되었습니다.`);
                        setNudgeModal(null);
                      } else {
                        alert('❌ 전송 중 서버 오류가 발생했습니다.');
                      }
                    } catch (e) {
                      console.error(e);
                      alert('❌ 네트워크 오류가 발생했습니다.');
                    }
                  }}
                  className="flex-[1.5] py-3 bg-red-500 text-white rounded-xl text-xs font-black shadow-lg shadow-red-200 hover:bg-red-600 transition-all"
                >
                  🚀 즉시 알림 발송
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {previewModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4" onClick={() => setPreviewModal(null)}>
          <div className="bg-white w-[600px] rounded-[2rem] overflow-hidden shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-5 bg-slate-800 text-white flex justify-between"><h3 className="font-black text-sm">배달 지원 공고 상세 및 배포</h3><button onClick={() => setPreviewModal(null)} className="text-xl">✕</button></div>
            <div className="p-6 space-y-5 bg-slate-50 flex-1">
              <div><label className="text-[10px] font-black text-slate-500">배달 창구 명칭</label><input type="text" value={previewModal.title} onChange={e => setPreviewModal({ ...previewModal, title: e.target.value })} className="w-full p-2 border rounded text-xs font-black outline-none focus:border-teal-500" /></div>
            
        
              <div><label className="text-[10px] font-black text-slate-500">신청 안내 문구</label><textarea value={previewModal.description} onChange={e => setPreviewModal({ ...previewModal, description: e.target.value })} className="w-full p-2 border rounded text-xs outline-none focus:border-teal-500 min-h-[80px]" /></div>
              <button onClick={handleSavePreview} className="w-full py-3 bg-slate-900 text-white rounded-xl text-xs font-black shadow-md hover:bg-black transition-all">💾 기본 정보 저장하기</button>
              
              <div className="text-center p-5 border-2 border-dashed border-teal-200 bg-teal-50 rounded-xl">
                <Link href={`/survey/delivery/admin/survey-builder?id=${previewModal.id}`} className="px-5 py-3 bg-teal-600 text-white rounded-xl text-[11px] font-black shadow-md hover:bg-teal-700 block w-fit mx-auto">🛠️ 배달 신청 서식지 빌더(Builder) 개방</Link>
                <p className="text-[10px] text-teal-600 font-bold mt-3">Builder를 통해 사은품 셀렉션 옵션지와 주소 수령 방식을 정의하십시오.</p>
              </div>
     
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                <label className="text-[10px] font-black text-slate-500 block mb-2">🔗 모바일/웹 외부 배달 신청 배포 링크</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={`${typeof window !== 'undefined' ? window.location.origin : ''}/survey/public/${previewModal.id}`}
                    className="flex-1 p-2 bg-slate-100 rounded border border-slate-200 text-xs font-mono text-slate-500 outline-none"
                  />
                  <button
                    onClick={() => {
                      const link = `${window.location.origin}/survey/public/${previewModal.id}`;
                      navigator.clipboard.writeText(link);
                      alert('배달 신청 배포 링크가 클립보드에 복사되었습니다!');
                    }}
                    className="px-4 py-2 bg-teal-600 text-white rounded text-[11px] font-black hover:bg-teal-700 transition-colors shrink-0"
                  >
                    링크 복사
                  </button>
                </div>
              </div>
            </div>
            <div className="p-4 bg-white flex gap-2"><button onClick={() => setPreviewModal(null)} className="w-full py-2.5 border rounded-xl text-xs font-black text-slate-500 hover:bg-slate-50">닫기</button></div>
          </div>
        </div>
      )}
    </div>
  );
}