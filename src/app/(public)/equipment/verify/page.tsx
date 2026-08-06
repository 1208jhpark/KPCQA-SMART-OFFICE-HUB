import prisma from "@/lib/prisma";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getKSTDateString, getKSTDaysUntil, parseKSTDateOnly } from "@/utils/dateUtils";
import {
  addMonthsToCalibYmd,
  getLatestCalibBaseYmd,
  toCalibYmd,
} from "@/utils/equipmentCalib";
import { parseEquipmentArchiveMemo } from "@/utils/equipmentMemo";

export const dynamic = "force-dynamic";

function formatDate(raw: string | Date | null | undefined) {
  if (!raw) return "-";
  return getKSTDateString(raw) || "-";
}

function InfoCell({
  label,
  value,
  span = false,
  tone = "slate",
}: {
  label: string;
  value: ReactNode;
  span?: boolean;
  tone?: "slate" | "indigo" | "amber";
}) {
  const tones = {
    slate: "bg-slate-50 border-slate-100 text-slate-700",
    indigo: "bg-indigo-50/60 border-indigo-100 text-indigo-800",
    amber: "bg-amber-50 border-amber-100 text-amber-900",
  };
  const labelTone = {
    slate: "text-slate-400",
    indigo: "text-indigo-400",
    amber: "text-amber-600",
  };
  return (
    <div
      className={`p-2.5 rounded-xl border ${tones[tone]} ${span ? "col-span-2" : ""}`}
    >
      <div className={`text-[9px] font-bold mb-0.5 ${labelTone[tone]}`}>{label}</div>
      <div className="font-black text-[12px] leading-snug break-words">{value || "-"}</div>
    </div>
  );
}

/** 원본 + 부분폐기(_ARC_) 조각을 묶어 정상/폐기 수량 합산 */
async function resolveQtyBreakdown(equipment: {
  id: string;
  asset_no: string;
  qty: number;
  status: string;
  etc_memo: string | null;
}) {
  const baseAssetNo = String(equipment.asset_no || "").split("_ARC_")[0] || "";
  const memo = parseEquipmentArchiveMemo(equipment.etc_memo);
  const sourceId =
    memo.sourceEquipmentId ||
    (String(equipment.asset_no || "").includes("_ARC_") ? null : equipment.id);

  const related = await prisma.equipment.findMany({
    where: {
      OR: [
        { id: equipment.id },
        ...(sourceId ? [{ id: sourceId }] : []),
        ...(baseAssetNo
          ? [
              { asset_no: baseAssetNo },
              { asset_no: { startsWith: `${baseAssetNo}_ARC_` } },
            ]
          : []),
      ],
    },
    select: { id: true, qty: true, status: true, asset_no: true },
  });

  const byId = new Map(related.map((r) => [r.id, r]));
  let normalQty = 0;
  let archivedQty = 0;
  for (const row of byId.values()) {
    const q = Number(row.qty) || 0;
    if (row.status === "정상") normalQty += q;
    else archivedQty += q;
  }

  if (byId.size === 0) {
    const q = Number(equipment.qty) || 0;
    if (equipment.status === "정상") normalQty = q;
    else archivedQty = q;
  }

  const totalQty = normalQty + archivedQty;
  return { normalQty, archivedQty, totalQty };
}

export default async function PublicEquipmentVerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const resolvedParams = await searchParams;
  const eqId = resolvedParams.id;

  if (!eqId) return notFound();

  const equipment = await prisma.equipment.findUnique({
    where: { id: eqId },
    include: {
      histories: {
        orderBy: { calib_date: "desc" },
      },
    },
  });

  if (!equipment) {
    return (
      <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center p-6 text-center font-sans">
        <div className="text-5xl mb-3">🚫</div>
        <h1 className="text-lg font-black text-slate-800">존재하지 않거나 폐기된 자산입니다.</h1>
        <p className="text-[11px] text-slate-500 font-bold mt-2">QR 코드 또는 자산 ID를 다시 확인해 주세요.</p>
      </div>
    );
  }

  const categoryPath = equipment.category
    ? `/equipment/main/${equipment.category}`
    : null;
  const categoryMenu = categoryPath
    ? await prisma.interfaceConfig.findUnique({
        where: { path: categoryPath },
        select: { name: true },
      })
    : null;
  const categoryLabel = categoryMenu?.name || equipment.category || "-";

  const assetNo = equipment.asset_no?.split("_ARC_")[0] || "-";
  const { normalQty, archivedQty, totalQty } = await resolveQtyBreakdown(equipment);

  const baseCalib = getLatestCalibBaseYmd(equipment.histories);
  const nextCalibDate =
    addMonthsToCalibYmd(baseCalib, equipment.calib_cycle_mo) ||
    toCalibYmd(equipment.next_calib_date) ||
    "-";

  const lastCalibYmd = toCalibYmd(
    [...(equipment.histories || [])].sort(
      (a, b) =>
        new Date(b.calib_date || 0).getTime() - new Date(a.calib_date || 0).getTime()
    )[0]?.calib_date
  );

  const lastReplaceYmd = toCalibYmd(equipment.last_replace_date);
  const purchaseYmd = toCalibYmd(equipment.purchase_date);
  let nextReplaceDate = "-";
  if (purchaseYmd && equipment.replace_cycle_mo) {
    const d = parseKSTDateOnly(purchaseYmd);
    if (!Number.isNaN(d.getTime())) {
      d.setMonth(d.getMonth() + Number(equipment.replace_cycle_mo));
      nextReplaceDate = getKSTDateString(d) || "-";
    }
  }

  const dDay =
    nextCalibDate !== "-"
      ? (() => {
          const diff = getKSTDaysUntil(nextCalibDate);
          if (diff === 0) return "D-Day";
          if (diff > 0) return `D-${diff}`;
          return `D+${Math.abs(diff)}`;
        })()
      : null;

  const replaceDDay =
    nextReplaceDate !== "-"
      ? (() => {
          const diff = getKSTDaysUntil(nextReplaceDate);
          if (diff === 0) return "D-Day";
          if (diff > 0) return `D-${diff}`;
          return `D+${Math.abs(diff)}`;
        })()
      : null;

  const isArchived = equipment.status !== "정상";

  return (
    <div className="min-h-screen bg-slate-100 p-4 font-sans flex flex-col items-center justify-start pb-12">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-xl overflow-hidden border border-slate-200/80">
        <div className="bg-slate-900 p-6 text-white text-center">
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <span className="bg-indigo-600 text-white px-3 py-1 rounded-full text-[10px] font-black tracking-wider">
              {equipment.department || "공용 장비"}
            </span>
            {isArchived && (
              <span className="bg-red-500/90 text-white px-2.5 py-1 rounded-full text-[10px] font-black">
                {equipment.status}
              </span>
            )}
          </div>
          <h1 className="text-xl font-black mt-3 text-white tracking-tight">{equipment.name}</h1>
          <p className="text-xs text-indigo-300 font-mono font-bold mt-1">{assetNo}</p>
          <p className="text-[10px] text-slate-400 font-bold mt-3">장비 공개 정보 · 로그인 없이 조회</p>
        </div>

        <div className="p-5 space-y-5">
          <div className="space-y-2.5">
            <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest border-b pb-1">
              기본 정보
            </h2>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <InfoCell label="장비 종류 범주" value={categoryLabel} />
              <InfoCell label="장비관리소속" value={equipment.department || "공용"} />
              <InfoCell label="제조사" value={equipment.brand || "-"} />
              <InfoCell label="모델번호" value={equipment.model_name || "-"} />
              <InfoCell label="시리얼번호" value={equipment.serial_no || "-"} />
              <InfoCell
                label="보유개수"
                value={
                  <span>
                    {totalQty} EA
                    <span className="text-[10px] font-bold text-slate-500 ml-1.5">
                      (정상 {normalQty} / 폐기 {archivedQty})
                    </span>
                  </span>
                }
              />
              <InfoCell
                label="제품사양 요약"
                span
                value={equipment.spec_summary || "등록된 사양 정보가 없습니다."}
              />
              {equipment.purpose ? (
                <InfoCell label="제품위치" span value={equipment.purpose} />
              ) : null}
            </div>
          </div>

          <div className="space-y-2.5">
            <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest border-b pb-1">
              검교정 · 교체
            </h2>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <InfoCell label="최근 검교정확정일" value={lastCalibYmd || "-"} tone="indigo" />
              <InfoCell
                label="검교정 주기"
                value={equipment.calib_cycle_mo ? `${equipment.calib_cycle_mo}개월` : "-"}
                tone="indigo"
              />
              <InfoCell
                label="다음 검교정 예정일"
                span
                tone="amber"
                value={
                  <span className="flex items-center gap-2 flex-wrap">
                    <span>{nextCalibDate}</span>
                    {dDay && (
                      <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                        {dDay}
                      </span>
                    )}
                  </span>
                }
              />
              <InfoCell label="구매일" value={formatDate(equipment.purchase_date)} />
              <InfoCell label="최근 소모품교체/수리일" value={lastReplaceYmd || "-"} />
              <InfoCell
                label="자동산정 교체예정일"
                span
                tone="amber"
                value={
                  <span className="flex items-center gap-2 flex-wrap">
                    <span>{nextReplaceDate}</span>
                    {replaceDDay && (
                      <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                        {replaceDDay}
                      </span>
                    )}
                  </span>
                }
              />
              <InfoCell
                label="상태 (정상 / 폐기)"
                span
                tone={isArchived ? "amber" : "slate"}
                value={
                  <span
                    className={`inline-flex items-center gap-1.5 font-black ${
                      isArchived ? "text-red-600" : "text-emerald-600"
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${
                        isArchived ? "bg-red-500" : "bg-emerald-500"
                      }`}
                    />
                    {equipment.status || "-"}
                    {!isArchived && archivedQty > 0 ? (
                      <span className="text-[10px] font-bold text-amber-700 ml-1">
                        (일부 폐기 {archivedQty}EA)
                      </span>
                    ) : null}
                  </span>
                }
              />
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-center space-y-2">
            <p className="text-[11px] font-black text-slate-700">더 자세한 정보가 필요하신가요?</p>
            <p className="text-[10px] font-bold text-slate-500 leading-relaxed">
              검교정 이력·첨부파일·수정은 Smart Office Hub에 로그인한 뒤
              <br />
              장비 코너에서 확인할 수 있습니다.
            </p>
          </div>
        </div>

        <div className="bg-white px-5 py-3 border-t border-slate-100 text-center">
          <p className="text-[9px] text-slate-400 font-bold">Smart Office Hub · Equipment Public Card</p>
        </div>
      </div>
    </div>
  );
}
