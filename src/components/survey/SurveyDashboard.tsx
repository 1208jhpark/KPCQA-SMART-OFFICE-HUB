'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { isPastKSTDeadline } from '@/utils/dateUtils';
import { normalizeGeneralResponsesPayload } from '@/utils/surveyGeneralResponses';
import { userInSurveyTarget } from '@/lib/survey-target-match';

// 로딩 스켈레톤 (와이드 형태)
const LoadingSkeleton = () => (
  <div className="w-full max-w-6xl mx-auto py-16 px-6 space-y-6 animate-pulse">
    <div className="w-64 h-10 bg-slate-200 rounded-lg mb-12"></div>
    <div className="w-full h-48 bg-slate-200 rounded-3xl"></div>
    <div className="w-full h-48 bg-slate-200 rounded-3xl"></div>
  </div>
);

export default function SurveyDashboard() {
  const [stats, setStats] = useState({
    general: { pending: 0, total: 0 },
    delivery: { pending: 0, total: 0 }
  });
  const [icons, setIcons] = useState({
    general: '📊',
    delivery: '📦',
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const syncData = async () => {
      try {
        const ts = Date.now();
        // 🚀 [DB 정합성 코어 1]: 마스터 데이터 파이프라인 병렬 실시간 수신
        const [uRes, unitsRes, generalSurveyRes, deliverySurveyRes, menuRes] = await Promise.all([
          fetch('/api/auth/me?t=' + ts, { cache: 'no-store' }).catch(() => null),
          fetch('/api/admin/units?active=true&t=' + ts, { cache: 'no-store' }).catch(() => null),
          fetch('/api/survey/general?t=' + ts, { cache: 'no-store' }).catch(() => null),
          fetch('/api/survey/delivery?t=' + ts, { cache: 'no-store' }).catch(() => null),
          fetch('/api/admin/interface?t=' + ts, { cache: 'no-store' }).catch(() => null),
        ]);

        const currentUser = uRes && uRes.ok ? await uRes.json() : null;
        const unitsList = unitsRes && unitsRes.ok ? await unitsRes.json() : [];
        const generalSurveys = generalSurveyRes && generalSurveyRes.ok ? await generalSurveyRes.json() : [];
        const deliverySurveys = deliverySurveyRes && deliverySurveyRes.ok ? await deliverySurveyRes.json() : [];
        const menus = menuRes && menuRes.ok ? await menuRes.json() : [];

        const iconOf = (path: string, fallback: string) => {
          if (!Array.isArray(menus)) return fallback;
          const hit = menus.find((m: any) => String(m?.path || '').trim() === path);
          const icon = String(hit?.icon || '').trim();
          return icon || fallback;
        };
        setIcons({
          general: iconOf('/survey/general', '📊'),
          delivery: iconOf('/survey/delivery', '📦'),
        });

        if (!currentUser) {
          // 💡 미로그인/세션 만료 시 무음 실패 방지
          setLoading(false);
          return;
        }

        const myUnit = unitsList.find((u: any) => u.id === currentUser.dept_id || u.id === currentUser.unit_id);
        currentUser.unit = myUnit || { unit_name: '소속없음' };
        const userEmail = String(currentUser.email || '').trim();
        if (!userEmail) {
          setLoading(false);
          return;
        }
        const userUnitId = currentUser.unit_id || currentUser.dept_id || currentUser.unit?.id;
        const userDeptName = currentUser.unit?.unit_name;
        const isLv1 = Array.isArray(currentUser.roles) && currentUser.roles.includes('LV_1');

        // general/delivery 대시보드와 동일: userInSurveyTarget (target_unit_ids 우선)
        const checkHierarchyTarget = (survey: any) =>
          userInSurveyTarget({
            userUnitId,
            userDeptName,
            target: survey?.target,
            targetUnitIds: survey?.target_unit_ids,
            units: unitsList,
          });

        // 🚀 [DB 정합성 코어 2]: 응답 대장 서버 실시간 호출 (도메인별 에러 완전 격리)
        let gFetchFailed = false;
        let dFetchFailed = false;

        const [generalRespRes, deliveryRespRes] = await Promise.all([
          fetch('/api/survey/general', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'GET_RESPONSES' }),
            cache: 'no-store'
          }).catch(() => null),
          fetch('/api/survey/delivery', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'GET_RESPONSES' }),
            cache: 'no-store'
          }).catch(() => null)
        ]);

        if (!generalRespRes || !generalRespRes.ok) gFetchFailed = true;
        if (!deliveryRespRes || !deliveryRespRes.ok) dFetchFailed = true;

        if (gFetchFailed || dFetchFailed) {
          alert('일부 응답 데이터를 가져오는데 실패했습니다. 해당 영역의 통계가 0건으로 보일 수 있습니다.');
        }

        const generalPayload = !gFetchFailed ? await generalRespRes!.json() : [];
        const dbDeliveryResponses = !dFetchFailed ? await deliveryRespRes!.json() : [];
        const { responses: dbGeneralResponses } = normalizeGeneralResponsesPayload(generalPayload);

        // 내 참여 여부 판단용 해시맵 빌드
        const generalResponsesMap: Record<string, boolean> = {};
        const emailKey = String(userEmail || '').trim().toLowerCase();
        dbGeneralResponses.forEach((r: any) => {
          if (String(r.userEmail || '').trim().toLowerCase() === emailKey) {
            generalResponsesMap[r.surveyId] = true;
          }
        });

        const deliveryRows = Array.isArray(dbDeliveryResponses) ? dbDeliveryResponses : [];
        const deliveryResponsesMap: Record<string, boolean> = {};
        deliveryRows.forEach((r: any) => {
          if (String(r.userEmail || '').trim().toLowerCase() === emailKey) {
            deliveryResponsesMap[r.surveyId] = true;
          }
        });

        const isSurveyOpen = (s: any) =>
          s?.status === '진행중' && !isPastKSTDeadline(s.endDate, s.endTime);

        // -------------------------------------------------------------
        // [1] 일반 설문 — SurveyDashboardContent.myPendingCount 와 동일
        //     LV_1 이거나 대상이면 카운트
        // -------------------------------------------------------------
        let gPending = 0, gTotal = 0;
        generalSurveys.forEach((s: any) => {
          if (!isSurveyOpen(s)) return;
          const isTargeted = isLv1 || checkHierarchyTarget(s);
          if (!isTargeted) return;
          gTotal++;
          if (!gFetchFailed && !generalResponsesMap[s.id]) {
            gPending++;
          }
        });

        // -------------------------------------------------------------
        // [2] 배달/신청 — DeliveryDashboardContent.myPendingCount 와 동일
        //     LV_1 우회 없음 (실제 대상만)
        // -------------------------------------------------------------
        let dPending = 0, dTotal = 0;
        deliverySurveys.forEach((s: any) => {
          if (!isSurveyOpen(s)) return;
          const isTargeted = checkHierarchyTarget(s);
          if (!isTargeted) return;
          dTotal++;
          if (!dFetchFailed && !deliveryResponsesMap[s.id]) {
            dPending++;
          }
        });

        // 최종 상태 업데이트
        setStats({
          general: { pending: gPending, total: gTotal },
          delivery: { pending: dPending, total: dTotal }
        });

      } catch (err) {
        console.error("Dashboard Sync Error:", err);
        alert('대시보드 데이터를 동기화하는 중 오류가 발생했습니다.');
      } finally {
        setLoading(false);
      }
    };
    syncData();
  }, []);

  if (loading) return <LoadingSkeleton />;

  return (
    <div className="min-h-screen bg-slate-50 font-sans pb-24">
      {/* 프리미엄 헤더 영역 (Dark) */}
      <div className="bg-slate-900 pt-16 pb-32 px-6">
        <div className="max-w-6xl mx-auto">
          <p className="text-blue-400 font-black tracking-widest text-[11px] uppercase mb-4">
            SURVEY &amp; REQUEST OPERATIONS
          </p>
          <h1 className="text-4xl md:text-5xl font-extrabold text-white tracking-tight">
            전사 조사·설문 통합 관제 대시보드
          </h1>
          <p className="text-slate-400 mt-4 font-medium leading-relaxed md:whitespace-nowrap">
            사내 의사결정 설문 데이터와 임직원 복지 배송 접수 현황을 실시간 관리합니다.
          </p>
        </div>
      </div>

      {/* 메인 허브 패널 영역 */}
      <div className="max-w-6xl mx-auto px-6 -mt-16 space-y-6 relative z-10">

        {/* 일반 설문 와이드 패널 */}
        <WideHubPanel
          title="전사 일반·익명 설문"
          titleEn="SURVEY & OPINION"
          desc="사내 의견 수렴 및 주요 설문을 관리하고 실시간 참여 현황을 모니터링합니다."
          icon={icons.general}
          theme="indigo"
          stats={stats.general}
          statsLabel="참여 대기"
          link="/survey/general/dashboard"
        />

        {/* 배달/신청 와이드 패널 */}
        <WideHubPanel
          title="임직원 복지 배송 신청"
          titleEn="DELIVERY REQUEST"
          desc="꽃배달 등 상시 복지 신청과 명절 선물 배송지 조사를 통합 취합·관리합니다."
          icon={icons.delivery}
          theme="teal"
          stats={stats.delivery}
          statsLabel="신청 대기"
          link="/survey/delivery/dashboard"
        />

      </div>
    </div>
  );
}

// 와이드 형태의 프리미엄 패널 컴포넌트
const WideHubPanel = ({ title, titleEn, desc, icon, theme, stats, statsLabel = '참여 대기', link }: any) => {
  const colors: Record<string, any> = {
    indigo: {
      iconBg: 'bg-indigo-50 text-indigo-600',
      btnPrimary: 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-600/30',
      badge: 'bg-indigo-100 text-indigo-700',
    },
    teal: {
      iconBg: 'bg-teal-50 text-teal-600',
      btnPrimary: 'bg-teal-600 hover:bg-teal-700 shadow-teal-600/30',
      badge: 'bg-teal-100 text-teal-700',
    }
  };
  const c = colors[theme];

  return (
    <div className="bg-white rounded-[2rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-200 transition-all duration-300 hover:shadow-[0_20px_40px_rgb(0,0,0,0.08)] flex flex-col lg:flex-row items-center gap-10">

      <div className="flex-1 flex gap-6 w-full lg:w-auto">
        <div className={`w-20 h-20 shrink-0 rounded-[1.5rem] flex items-center justify-center text-4xl ${c.iconBg}`}>
          {icon}
        </div>
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h2 className="text-2xl font-black text-slate-900">{title}</h2>
            <span className={`px-2 py-0.5 rounded text-[10px] font-black tracking-widest uppercase ${c.badge}`}>
              {titleEn}
            </span>
          </div>
          <p className="text-sm text-slate-500 font-medium leading-relaxed">
            {desc}
          </p>
        </div>
      </div>

      <div className="w-full lg:w-auto shrink-0 border-y lg:border-y-0 lg:border-l border-slate-100 py-6 lg:py-0 lg:pl-10 lg:min-w-[9rem]">
        <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2">{statsLabel}</p>
        <div className="flex items-baseline gap-1">
          <span className="text-4xl font-black text-slate-800 tabular-nums leading-none">{stats.pending}</span>
          <span className="text-sm font-bold text-slate-400">/</span>
          <span className="text-xl font-black text-slate-500 tabular-nums">{stats.total}</span>
          <span className="text-[11px] font-bold text-slate-400">건</span>
        </div>
      </div>

      <div className="flex flex-col justify-center gap-3 w-full lg:w-48 shrink-0">
        <Link
          href={link}
          className={`w-full flex items-center justify-center gap-2 py-5 rounded-xl font-black text-sm text-white shadow-lg transition-all active:scale-95 ${c.btnPrimary}`}
        >
          현황판 진입 <span className="text-lg leading-none">→</span>
        </Link>
      </div>

    </div>
  );
};
