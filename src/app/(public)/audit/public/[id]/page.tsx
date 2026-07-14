'use client';
     
import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { Html5QrcodeScanner } from 'html5-qrcode';
     
export default function MobilePublicAuditPage() {
  const params = useParams();
  const id = params?.id as string; 
  const [audit, setAudit] = useState<any>(null);
  const [myAssets, setMyAssets] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [isVerified, setIsVerified] = useState(false);
  const [isIntroConfirmed, setIsIntroConfirmed] = useState(false); 
  const [users, setUsers] = useState<any[]>([]);
  
  const [currentAssetIndex, setCurrentAssetIndex] = useState(0);
  const [feedbackModal, setFeedbackModal] = useState<string | null>(null);
  const [feedbackContent, setFeedbackContent] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [isActivePeriod, setIsActivePeriod] = useState(true);
     
  const todayStr = new Date().toISOString().split('T')[0];
     
  const fetchInitialData = async () => {
    try {
      const ts = Date.now();
      const [auditRes, reqRes, uRes] = await Promise.all([
        fetch(`/api/asset/it/audit?t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/asset/it/requests?t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/admin/users?t=${ts}`, { cache: 'no-store' }) // 유저 정보도 캐시 방지
      ]);
     
      if (uRes.ok) {
        const uData = await uRes.json();
        setUsers(uData.users || []);
      }
      if (reqRes.ok) setRequests(await reqRes.json());
     
      if (auditRes.ok) {
        const audits = await auditRes.json();
        const found = audits.find((a: any) => a.id === id);
        
        if (found) {
          setAudit(found);
          const isStatusActive = found.status === '진행중';
          const isDateValid = todayStr >= found.startDate && todayStr <= found.endDate;
          
          if (!isStatusActive || !isDateValid) {
            setIsActivePeriod(false);
          }
        }
      }
    } catch (e) {
      console.error("공공 보안 채널 동기화 에러", e);
    } finally {
      setLoading(false);
    }
  };
     
  useEffect(() => {
    fetchInitialData();
  }, [id]);
     
  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    
    // 🚀 [보안 강화]: DB(users)에 일치하는 이메일이 있는지 엄격하게 검증
    const foundUser = users.find(u => u.email === email);
    
    // 일치하는 유저가 없으면 즉시 차단
    if (!foundUser) {
      alert("가입된 정보가 없습니다.\n사내 이메일 주소를 다시 확인해주세요.");
      return; 
    }

    // 검증을 통과한 진짜 유저의 이름
    const userName = foundUser.name;
    
    try {
      const assetRes = await fetch(`/api/asset/it?t=${Date.now()}`, { cache: 'no-store' });
      if (assetRes.ok) {
        const allAssets = await assetRes.json();
        const filtered = allAssets.filter((a: any) => a.user === userName);
        setMyAssets(filtered);
        setIsVerified(true);
      }
    } catch (err) {
      alert("자산 마스터 정보를 불러오지 못했습니다.");
    }
  };
     
  const handleVerifySingleAsset = async (assetId: string) => {
    const currentAsset = myAssets.find(ma => ma.id === assetId);
    if (!currentAsset) return;
     
    try {
      const assetUpdate = await fetch('/api/asset/it', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: assetId,
          last_audit_date: todayStr,
          audit_request_date: '' 
        })
      });
     
      await fetch('/api/asset/it/audit', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: audit.id,
          responses: {
            upsert: {
              where: { auditId_userEmail: { auditId: audit.id, userEmail: email } },
              update: { isDone: true, date: todayStr },
              create: { userEmail: email, isDone: true, date: todayStr }
            }
          }
        })
      }).catch(() => null); 
     
      if (assetUpdate.ok) {
        setMyAssets(prev => prev.map(a => a.id === assetId ? { ...a, last_audit_date: todayStr, audit_request_date: '' } : a));
        alert(`자산 [${currentAsset.code}] 실사 인증이 완료되었습니다.`);
        
        setTimeout(() => {
          if (currentAssetIndex < myAssets.length - 1) {
            setCurrentAssetIndex(prev => prev + 1);
          }
        }, 600);
      }
    } catch (error) {
      alert("서버 통신 오류로 인해 실사 확인에 실패했습니다.");
    }
  };
     
  const handleSendFeedback = async () => {
    if (!feedbackContent.trim()) return alert("의견 내용을 입력해주세요.");
    
    const currentAsset = myAssets[currentAssetIndex];
    if (!currentAsset) return;
     
    const newReq = {
      assetCode: currentAsset.code,
      assetType: currentAsset.it_type || currentAsset.category,
      content: feedbackContent,
      requester: currentAsset.user,
      dept: currentAsset.dept,
      status: '의견전송',
      requestDate: todayStr
    };
    
    try {
      const response = await fetch('/api/asset/it/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newReq)
      });
     
      if (response.ok) {
        alert("📊 자산 관리자에게 특이사항 의견 전송이 완료되었습니다.");
        setFeedbackModal(null);
        setFeedbackContent('');
        fetchInitialData(); 
      }
    } catch (error) {
      alert("의견 전송 실패");
    }
  };
     
  const handleCloseWindow = () => {
    if (confirm("실사 인증을 종료하고 창을 닫으시겠습니까?")) {
      window.location.href = "about:blank";
    }
  };
     
  useEffect(() => {
    let scanner: Html5QrcodeScanner | null = null;
    if (isScanning) {
      scanner = new Html5QrcodeScanner("reader", { qrbox: { width: 250, height: 250 }, fps: 10 }, false);
      scanner.render((decodedText) => {
        scanner?.clear();
        setIsScanning(false);
        
        let scannedCode = decodedText;
        try {
          const url = new URL(decodedText);
          scannedCode = url.searchParams.get('id') || decodedText;
        } catch (e) {}
     
        const currentAsset = myAssets[currentAssetIndex];
        if (currentAsset.code === scannedCode) {
          alert(`✅ QR 스캔 일치 성공!\n[${currentAsset.code}] 장비 실사 인증을 진행합니다.`);
          handleVerifySingleAsset(currentAsset.id);
        } else {
          alert(`❌ 장비 불일치 경고!\n스캔된 코드(${scannedCode})는\n현재 인증 대상인 [${currentAsset.code}] 장비가 아닙니다.`);
        }
      }, () => {});
    }
    return () => { if (scanner) scanner.clear().catch(console.error); };
  }, [isScanning, currentAssetIndex, myAssets]);
     
  const verifiedCount = useMemo(() => {
    if (!audit) return 0;
    return myAssets.filter(a => a.last_audit_date && a.last_audit_date >= audit.startDate).length;
  }, [myAssets, audit]);
     
  if (loading) return <div className="text-center p-20 font-black text-slate-500 animate-pulse text-xs">모바일 보안 채널 구동 중...</div>;
  if (!audit) return <div className="text-center p-20 text-red-500 font-black text-xs">존재하지 않는 실사 링크입니다.</div>;
  
  if (!isActivePeriod) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4 font-sans w-full max-w-md mx-auto shadow-2xl border-x text-center">
        <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-xl w-full">
          <div className="text-5xl mb-4">🔒</div>
          <h1 className="text-base font-black text-slate-800 tracking-tight">정기 실사 기간 종료 안내</h1>
          <p className="text-[11px] text-slate-400 font-bold mt-3 mb-6 leading-relaxed">
            본 실사 링크는 운영 기간이 마감되었거나<br />
            관리자에 의해 정지되었습니다.<br />
            <span className="text-indigo-600 font-black">(실사 운영 기간: {audit.startDate} ~ {audit.endDate})</span>
          </p>
          <button onClick={() => window.close()} className="w-full py-3.5 bg-slate-900 text-white rounded-xl font-black text-xs">
            확인 (창 닫기)
          </button>
        </div>
      </div>
    );
  }
     
  if (isVerified) {
    if (!isIntroConfirmed) {
      return (
        <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4 font-sans w-full max-w-md mx-auto shadow-2xl border-x">
          <div className="bg-white p-8 rounded-[2rem] shadow-xl w-full border border-slate-200">
            <h2 className="text-indigo-600 font-black text-[11px] uppercase tracking-widest mb-2">실사 안내문</h2>
            <h1 className="text-xl font-black text-slate-900 tracking-tight mb-6 leading-snug">{audit.title}</h1>
            
            <div className="space-y-4 mb-8">
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                <span className="text-[9px] font-black text-slate-400 uppercase">상세 설명</span>
                <p className="text-xs font-bold text-slate-700 mt-1.5 leading-relaxed whitespace-pre-wrap">
                  {audit.description || '등록된 상세 설명이 없습니다.'}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                  <span className="text-[9px] font-black text-slate-400 uppercase">대상 범위</span>
                  <p className="text-xs font-black text-slate-800 mt-1 truncate">{audit.target || '전사'}</p>
                </div>
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                  <span className="text-[9px] font-black text-slate-400 uppercase">실사 기간</span>
                  <p className="text-[10px] font-black text-slate-800 mt-1 leading-tight">{audit.startDate}<br/>~ {audit.endDate}</p>
                </div>
              </div>
            </div>
            
            <button 
              onClick={() => setIsIntroConfirmed(true)} 
              className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-black text-xs shadow-lg shadow-indigo-200 transition-colors"
            >
              내 자산 실사 시작하기 →
            </button>
          </div>
        </div>
      );
    }

    const currentAsset = myAssets[currentAssetIndex];
    const isAssetVerified = currentAsset?.last_audit_date && currentAsset.last_audit_date >= audit.startDate;
    const isFeedbackSent = requests.some(r => r.assetCode === currentAsset?.code && r.requestDate >= audit.startDate);
     
    return (
      <>
        <div className="min-h-[100dvh] bg-slate-100 flex flex-col justify-between font-sans w-full max-w-md mx-auto shadow-2xl relative border-x border-slate-200">
          <div className="bg-slate-900 text-white p-5 pt-6 rounded-b-[2rem] shadow-md sticky top-0 z-40">
            <div className="flex justify-between items-center mb-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-indigo-400">KPCQA IT ASSET AUDIT</span>
              <span className="bg-indigo-600 text-white font-mono font-black text-[10px] px-2.5 py-0.5 rounded-full">
                {currentAssetIndex + 1} / {myAssets.length} 장비
              </span>
            </div>
            <h1 className="text-lg font-black tracking-tight truncate">{audit.title}</h1>
            <div className="mt-4 bg-white/10 p-3 rounded-xl border border-white/10 flex justify-between items-center text-xs">
              <span className="font-bold text-slate-300">내 장비 실사 현황</span>
              <span className="font-black text-white text-sm">
                인증완료 <span className="text-emerald-400">{verifiedCount}건</span> / {myAssets.length}건
              </span>
            </div>
          </div>
     
          <div className="flex-1 p-5 flex flex-col justify-start space-y-4 overflow-y-auto pb-10 relative">
            {isScanning && (
              <div className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-4 backdrop-blur-sm">
                <h3 className="text-white font-black text-lg mb-4 text-center leading-snug">카메라 사각형 안에<br/>장비 라벨의 QR 코드를 맞춰주세요</h3>
                <div id="reader" className="w-full max-w-sm overflow-hidden rounded-2xl bg-white"></div>
                <button onClick={() => setIsScanning(false)} className="mt-8 px-8 py-4 bg-white/20 text-white border border-white/30 rounded-full font-black text-sm">스캔 취소하기</button>
              </div>
            )}
     
            <button onClick={() => setIsScanning(true)} disabled={myAssets.length === 0} className="w-full bg-gradient-to-r from-indigo-600 to-blue-600 text-white py-4 rounded-2xl font-black text-xs shadow-md flex items-center justify-center gap-2">
              <span className="text-base">📷</span> <span className="tracking-wide">자산 라벨 QR 코드 촬영(스캔)</span>
            </button>
     
            {currentAsset ? (
              <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5 space-y-4">
                <div className="border-b pb-3 flex justify-between items-center">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">장비 상세 제원 정보</span>
                  <span className={`px-2 py-0.5 rounded text-[9px] font-black ${isAssetVerified ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-red-50 text-red-500 border border-red-100'}`}>
                    {isAssetVerified ? '인증완료' : '검증 필요'}
                  </span>
                </div>
     
                <div className="space-y-3 text-xs">
                  <div className="flex flex-col border-b border-slate-100 pb-2"><span className="text-[9px] text-slate-400 font-black uppercase">자산 분류</span><span className="text-slate-900 font-black text-sm mt-0.5">{currentAsset.it_type}</span></div>
                  <div className="flex flex-col border-b border-slate-100 pb-2"><span className="text-[9px] text-slate-400 font-black uppercase">자산 번호 (Code)</span><span className="text-indigo-600 font-mono font-black text-sm mt-0.5">{currentAsset.code}</span></div>
                  <div className="flex flex-col border-b border-slate-100 pb-2"><span className="text-[9px] text-slate-400 font-black uppercase">모델 정보 (Model)</span><span className="text-slate-800 font-bold mt-0.5">{currentAsset.model || '-'}</span></div>
                  <div className="flex flex-col border-b border-slate-100 pb-2"><span className="text-[9px] text-slate-400 font-black uppercase">기기 시리얼 (S/N)</span><span className="text-slate-600 font-mono font-bold mt-0.5">{currentAsset.sn || '-'}</span></div>
                  <div className="flex flex-col"><span className="text-[9px] text-slate-400 font-black uppercase">기본 사양 제원</span><span className="text-slate-500 font-medium leading-relaxed mt-1 bg-slate-50 p-3 rounded-lg border border-slate-100 block text-[11px]">{currentAsset.spec || '등록된 사양 요약 정보가 없습니다.'}</span></div>
                </div>
     
                <div className="pt-4 space-y-2">
                  <button onClick={() => setFeedbackModal(currentAsset.id)} className={`w-full py-3.5 rounded-xl font-black text-[11px] shadow-sm flex items-center justify-center gap-1.5 ${isFeedbackSent ? 'bg-pink-50 border border-pink-200 text-pink-600' : 'bg-white border border-slate-300 text-slate-600'}`}>
                    <span>💬</span> {isFeedbackSent ? '관리자에게 의견 전송완료' : '관리자에게 이상유무 의견 전송'}
                  </button>
                  <button onClick={() => handleVerifySingleAsset(currentAsset.id)} className={`w-full py-4 rounded-xl font-black text-xs shadow-md transition-all ${isAssetVerified ? 'bg-emerald-500 text-white cursor-default' : 'bg-slate-900 text-white hover:bg-black'}`}>
                    ✓ {isAssetVerified ? '이 장비의 실사확인 완료하였습니다' : '수동으로 이 장비 실사 완료하기'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-2xl p-8 text-center text-slate-400 font-bold text-xs border border-dashed">실사 조치 대상 장비가 없습니다.</div>
            )}
     
            {currentAssetIndex === myAssets.length - 1 && (
              <div className="pt-2 pb-6">
                <button onClick={handleCloseWindow} className="w-full bg-slate-200 text-slate-600 py-4 rounded-2xl font-black text-xs shadow-sm">실사 종료하기 (확인 완료)</button>
              </div>
            )}
          </div>
     
          <div className="bg-white border-t border-slate-200 p-4 flex justify-between items-center rounded-t-[1.5rem] sticky bottom-0 z-40">
            <button disabled={currentAssetIndex === 0} onClick={() => setCurrentAssetIndex(prev => prev - 1)} className="px-4 py-2.5 bg-slate-100 text-slate-600 rounded-xl font-black text-xs disabled:opacity-30 border">◀ 이전</button>
            <span className="text-[11px] font-black text-slate-400 font-mono">{currentAssetIndex + 1} / {myAssets.length}</span>
            <button disabled={currentAssetIndex === myAssets.length - 1} onClick={() => setCurrentAssetIndex(prev => prev + 1)} className="px-4 py-2.5 bg-slate-100 text-slate-600 rounded-xl font-black text-xs disabled:opacity-30 border">다음 ▶</button>
          </div>
        </div>
     
        {feedbackModal && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-sm rounded-[2rem] p-6 shadow-2xl animate-in zoom-in-95 duration-200">
              <h3 className="font-black text-sm text-slate-900 mb-1">관리자에게 의견 전송</h3>
              <p className="text-[10px] text-slate-500 mb-4">장비의 파손, 분실, 스펙 불일치 등 조치가 필요한 사항을 남겨주세요.</p>
              <textarea value={feedbackContent} onChange={(e) => setFeedbackContent(e.target.value)} placeholder="상세 내용을 입력해주세요..." className="w-full h-32 bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs font-bold outline-none resize-none" />
              <div className="flex gap-2 mt-4">
                <button onClick={() => { setFeedbackModal(null); setFeedbackContent(''); }} className="flex-1 py-3.5 bg-slate-100 text-slate-600 font-black text-[11px] rounded-xl">취소</button>
                <button onClick={handleSendFeedback} className="flex-[2] py-3.5 bg-indigo-600 text-white font-black text-[11px] rounded-xl">🚀 전송하기</button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }
     
  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4 font-sans w-full max-w-md mx-auto shadow-2xl border-x">
      <form onSubmit={handleVerify} className="bg-white p-6 rounded-[2rem] shadow-xl w-full text-center border border-slate-200/80">
        <div className="text-4xl mb-3">📱</div>
        <h1 className="text-base font-black text-slate-800 tracking-tight">스마트 자산 실사 채널</h1>
        <p className="text-[10px] text-slate-400 font-bold mb-6 mt-1">임직원 이메일 계정을 통해 본인 소유 기기를 실시간 조회합니다.</p>
        <input type="email" required value={email} onChange={e => setEmail(e.target.value)} className="w-full p-3.5 mb-4 border border-slate-200 rounded-xl text-xs font-black text-center outline-none bg-slate-50" placeholder="your.name@kpcqa.or.kr" />
        <button type="submit" className="w-full py-3.5 bg-slate-900 text-white rounded-xl font-black text-xs shadow-md">본인 자산 리스트 확인하기</button>
      </form>
    </div>
  );
}