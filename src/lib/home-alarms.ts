import fs from 'fs/promises';
import path from 'path';
import type { User } from '@prisma/client';
import prisma from '@/lib/prisma';
import { collectDescendantUnitIds } from '@/lib/org-unit-match';
import { userInSurveyTarget } from '@/lib/survey-target-match';
import { assetInAuditTarget, userMatchesAuditTarget } from '@/utils/itAuditTarget';
import { computeItAssetReplaceSchedule } from '@/utils/itAssetSchedule';
import { getKSTDateString, getKSTDaysUntil, isPastKSTDeadline } from '@/utils/dateUtils';
import { isActiveEquipmentRow } from '@/utils/equipmentActive';
import { resolveCalibSchedule } from '@/utils/equipmentCalib';
import { isGlobalMgmtOrgMember } from '@/utils/orgUnits';
import { SNOOZABLE_ALARM_IDS } from '@/lib/alarm-snooze';
import { SUPPLY_REQUEST_PENDING_STATUSES } from '@/utils/supplyRequestStatus';

export type HomeAlarm = {
  id: string;
  label: string;
  count: number;
  href: string;
  /** 최신 발생 시각(ms) — 목록 역순 정렬 */
  at: number;
  /** 표시용 YYYY-MM-DD (KST) */
  date: string;
  /** 장기 수명주기 경고 — 재알림(N일) 가능 */
  snoozable?: boolean;
};

export { ALARM_SNOOZE_DAYS, SNOOZABLE_ALARM_IDS } from '@/lib/alarm-snooze';

type SessionUser = User & {
  unit?: { id: string; unit_name: string; parent_id?: string | null; parent?: { unit_name?: string | null } | null } | null;
};

function asArray(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function isLv1(roles: unknown) {
  return asArray(roles).some((r) => {
    const m = String(r || '').match(/(\d+)/);
    return m ? `LV_${m[0]}` === 'LV_1' : String(r) === 'LV_1';
  });
}

/** 명단 row: { email } 또는 예전 문자열 email */
function listedEmails(rows: unknown): string[] {
  return asArray(rows)
    .map((row) => {
      if (typeof row === 'string') return row.trim().toLowerCase();
      return String(row?.email || '').trim().toLowerCase();
    })
    .filter(Boolean);
}

/** Master 책임자 · Task Access · Task Editor 만. 일반 Edit 레벨(LV_*)은 제외 */
function isSpecialAssignee(menu: any, user: { id: string; email: string }) {
  if (!menu) return false;
  if (
    menu.master_editor_id &&
    String(menu.master_editor_id).trim() === String(user.id || '').trim()
  ) {
    return true;
  }
  const email = String(user.email || '').trim().toLowerCase();
  if (!email) return false;
  const listed = [
    ...listedEmails(menu.task_accesses),
    ...listedEmails(menu.task_masters),
  ];
  return listed.includes(email);
}

function menuByPath(menus: any[], menuPath: string) {
  const key = menuPath.replace(/\/$/, '').toLowerCase();
  return menus.find((m) => String(m.path || '').replace(/\/$/, '').toLowerCase() === key) || null;
}

/**
 * 해당 경로 메뉴 + 상위(parent) 체인에서 Master / Task Access / Task Editor 여부.
 * admin/interface 에서 L3에만 지정해도 L4 알람이 뜨도록 함.
 */
function isSpecialAssigneeOnPath(
  menus: any[],
  menuPath: string,
  user: { id: string; email: string }
) {
  const byId = new Map(menus.map((m) => [String(m.id), m]));
  let cur = menuByPath(menus, menuPath);
  const seen = new Set<string>();
  while (cur) {
    const id = String(cur.id || '');
    if (id) {
      if (seen.has(id)) break;
      seen.add(id);
    }
    if (isSpecialAssignee(cur, user)) return true;
    const pid = cur.parent_id != null ? String(cur.parent_id) : '';
    cur = pid ? byId.get(pid) || null : null;
  }
  return false;
}

function toAt(raw: unknown): number {
  if (raw == null || raw === '') return 0;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const t = new Date(raw as string | number | Date).getTime();
  return Number.isFinite(t) ? t : 0;
}

export function parseAlarmSnoozes(raw: unknown): Record<string, number> {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const id = String(k || '').trim();
    if (!id) continue;
    const t = typeof v === 'number' ? v : toAt(v);
    if (t > 0) out[id] = t;
  }
  return out;
}

export function isAlarmSnoozedNow(snoozes: Record<string, number>, alarmId: string, now = Date.now()) {
  const until = snoozes[alarmId];
  return typeof until === 'number' && until > now;
}

function maxAt(...vals: unknown[]): number {
  let best = 0;
  for (const v of vals) {
    const t = toAt(v);
    if (t > best) best = t;
  }
  return best;
}

function pushAlarm(
  list: HomeAlarm[],
  item: { id: string; label: string; count: number; href: string; at?: number | null } | null
) {
  if (!item || item.count <= 0) return;
  // at 없으면 Date.now()를 쓰지 않음 — 매 요청마다 바뀌면 ✕ 삭제가 풀림
  const at = item.at && item.at > 0 ? item.at : 0;
  const date =
    (at > 0 ? getKSTDateString(at) : null) || getKSTDateString() || '';
  list.push({
    id: item.id,
    label: item.label,
    count: item.count,
    href: item.href,
    at,
    date,
    snoozable: SNOOZABLE_ALARM_IDS.has(item.id),
  });
}

async function readJsonFile(filePath: string): Promise<any> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function buildHomeAlarms(user: SessionUser): Promise<HomeAlarm[]> {
  const email = String(user.email || '').trim();
  const emailKey = email.toLowerCase();
  const unitId = String(user.unit_id || user.unit?.id || '').trim();
  const unitName = String(user.unit?.unit_name || '').trim();
  const alarms: HomeAlarm[] = [];
  let snoozes: Record<string, number> = parseAlarmSnoozes((user as any).alarm_snoozes);
  if (Object.keys(snoozes).length === 0 && user.id) {
    try {
      const rows = await prisma.$queryRaw<Array<{ alarm_snoozes: unknown }>>`
        SELECT "alarm_snoozes" FROM "User" WHERE id = ${user.id} LIMIT 1
      `;
      if (rows[0]) snoozes = parseAlarmSnoozes(rows[0].alarm_snoozes);
    } catch {
      /* 컬럼 미적용 환경에서는 스누즈 없이 진행 */
    }
  }

  const [menus, units, config] = await Promise.all([
    prisma.interfaceConfig.findMany(),
    prisma.orgUnit.findMany({
      where: { is_deleted: false, is_active: true },
      select: { id: true, unit_name: true, parent_id: true },
    }),
    prisma.systemConfig.findUnique({ where: { id: 'global' } }),
  ]);

  const special = (menuPath: string) => isSpecialAssigneeOnPath(menus, menuPath, user);
  const lv1 = isLv1(user.roles);
  const scopeIds = unitId ? collectDescendantUnitIds(unitId, units) : new Set<string>();

  const surveyTargeted = (row: { target?: string | null; target_unit_ids?: unknown }) =>
    lv1 ||
    userInSurveyTarget({
      userUnitId: unitId,
      userDeptName: unitName,
      target: row.target,
      targetUnitIds: row.target_unit_ids,
      units,
    });

  await Promise.all([
    (async () => {
      if (!special('/asset/supplies/master/dashboard')) return;
      const items = await prisma.supplyItem.findMany({
        where: { is_active: true },
        select: { current_stock: true, alert_qty: true, updatedAt: true },
      });
      let low = 0;
      let out = 0;
      let lowAt = 0;
      let outAt = 0;
      for (const item of items) {
        const stock = Number(item.current_stock) || 0;
        const safety = Number(item.alert_qty) || 0;
        const at = toAt(item.updatedAt);
        // 대시보드와 동일: 품절(0) / 재고부족(0 < stock ≤ 안전재고)
        if (stock === 0) {
          out += 1;
          if (at > outAt) outAt = at;
        } else if (stock > 0 && stock <= safety) {
          low += 1;
          if (at > lowAt) lowAt = at;
        }
      }
      pushAlarm(alarms, {
        id: 'supply-low',
        label: '[소모품] 재고 부족',
        count: low,
        href: '/asset/supplies/master/dashboard',
        at: lowAt,
      });
      pushAlarm(alarms, {
        id: 'supply-out',
        label: '[소모품] 재고 품절',
        count: out,
        href: '/asset/supplies/master/dashboard',
        at: outAt,
      });
    })(),
    (async () => {
      if (!special('/asset/supplies/master/requests')) return;
      const rows = await prisma.supplyRequest.findMany({
        where: { status: { in: [...SUPPLY_REQUEST_PENDING_STATUSES] } },
        select: { createdAt: true },
      });
      pushAlarm(alarms, {
        id: 'supply-new',
        label: '[소모품] 신규 신청 대기',
        count: rows.length,
        href: '/asset/supplies/master/requests',
        at: maxAt(...rows.map((r) => r.createdAt)),
      });
    })(),
    (async () => {
      if (!special('/asset/it/master/dashboard')) return;
      const USER_INCOMING = ['의견전송', '답변 대기중', '답변회신', '대기중'];
      const [assets, requests] = await Promise.all([
        prisma.iTAsset.findMany({
          where: { is_active: true },
          select: { code: true },
        }),
        prisma.iTRequest.findMany({
          select: { assetCode: true, status: true, createdAt: true, requestDate: true },
        }),
      ]);
      const latestByCode = new Map<string, { status: string; at: number }>();
      for (const row of requests) {
        const code = String(row.assetCode || '').trim();
        if (!code) continue;
        const at = maxAt(row.createdAt, row.requestDate);
        const prev = latestByCode.get(code);
        if (!prev || at >= prev.at) latestByCode.set(code, { status: String(row.status || ''), at });
      }
      let count = 0;
      let latestAt = 0;
      for (const asset of assets) {
        const latest = latestByCode.get(String(asset.code || '').trim());
        if (latest && USER_INCOMING.includes(latest.status)) {
          count += 1;
          if (latest.at > latestAt) latestAt = latest.at;
        }
      }
      pushAlarm(alarms, {
        id: 'it-inbox',
        label: '[IT자산] 사용자 의견 도착',
        count,
        href: '/asset/it/master/dashboard',
        at: latestAt,
      });
    })(),
    (async () => {
      if (!special('/asset/it/master/dashboard')) return;
      const assets = await prisma.iTAsset.findMany({
        where: { is_active: true },
        select: {
          in_date: true,
          cycle: true,
          replace_deferred: true,
          updatedAt: true,
          createdAt: true,
        },
      });
      let d30 = 0;
      let overdue = 0;
      let d30At = 0;
      let overdueAt = 0;
      for (const asset of assets) {
        if (asset.replace_deferred === true) continue;
        const { replace_dday } = computeItAssetReplaceSchedule(asset);
        if (replace_dday == null) continue;
        const at = maxAt(asset.updatedAt, asset.createdAt);
        // 대시보드 교체(D-30): 1~30일 남음
        if (replace_dday > 0 && replace_dday <= 30) {
          d30 += 1;
          if (at > d30At) d30At = at;
        } else if (replace_dday <= 0) {
          // 교체(D-Day) + 교체(D+)
          overdue += 1;
          if (at > overdueAt) overdueAt = at;
        }
      }
      pushAlarm(alarms, {
        id: 'it-replace-d30',
        label: '[IT자산] 교체 예정 장비 (D-30)',
        count: d30,
        href: '/asset/it/master/dashboard',
        at: d30At,
      });
      pushAlarm(alarms, {
        id: 'it-replace-overdue',
        label: '[IT자산] 교체 기한 초과 (D+)',
        count: overdue,
        href: '/asset/it/master/dashboard',
        at: overdueAt,
      });
    })(),
    (async () => {
      if (!special('/asset/businesscard/master/requests')) return;
      const rows = await prisma.businessCardRequest.findMany({
        where: { isArchived: false, adminStatus: '대기중' },
        select: { createdAt: true },
      });
      pushAlarm(alarms, {
        id: 'bc-pending',
        label: '[명함] 신규 접수 대기',
        count: rows.length,
        href: '/asset/businesscard/master/requests',
        at: maxAt(...rows.map((r) => r.createdAt)),
      });
    })(),
    (async () => {
      if (!special('/asset/production/dept-master/order') || scopeIds.size === 0) return;
      const names = units
        .filter((u) => scopeIds.has(u.id))
        .map((u) => String(u.unit_name || '').trim())
        .filter(Boolean);
      const rows = await prisma.productionRequest.findMany({
        where: {
          status: 'PENDING',
          isArchived: false,
          OR: [
            { unitId: { in: [...scopeIds] } },
            ...(names.length ? [{ unitId: null, deptName: { in: names } }] : []),
          ],
        },
        select: { createdAt: true },
      });
      pushAlarm(alarms, {
        id: 'prod-new',
        label: '[제작물] 신규 신청 대기',
        count: rows.length,
        href: '/asset/production/dept-master/order',
        at: maxAt(...rows.map((r) => r.createdAt)),
      });
    })(),
    (async () => {
      if (!special('/asset/production/dept-master/settlement')) return;
      const dir = path.join(process.cwd(), 'public', 'uploads', 'production-statement');
      const [meta, publish, confirms] = await Promise.all([
        readJsonFile(path.join(dir, 'meta.json')),
        readJsonFile(path.join(dir, 'statement-publish.json')),
        readJsonFile(path.join(dir, 'confirm-requests.json')),
      ]);
      const files = Array.isArray(meta) ? meta : Array.isArray(meta?.files) ? meta.files : [];
      const published = publish && typeof publish === 'object' ? publish : {};
      let fileCount = 0;
      let fileAt = 0;
      for (const [category, row] of Object.entries(published as Record<string, any>)) {
        if (row?.published !== true) continue;
        const catFiles = files.filter((f: any) => String(f?.category || '') === category);
        fileCount += catFiles.length;
        fileAt = maxAt(fileAt, row?.updatedAt, ...catFiles.map((f: any) => f?.uploadedAt));
      }
      pushAlarm(alarms, {
        id: 'prod-statement',
        label: '[제작물] 명세서 대조 대기',
        count: fileCount,
        href: '/asset/production/dept-master/settlement',
        at: fileAt,
      });
      const memoRows = Object.values((confirms && typeof confirms === 'object' ? confirms : {}) as Record<string, any>).filter(
        (row) => String(row?.memo || '').trim()
      );
      pushAlarm(alarms, {
        id: 'prod-statement-memo',
        label: '[제작물] 관리자 메모 도착',
        count: memoRows.length,
        href: '/asset/production/dept-master/settlement',
        at: maxAt(...memoRows.map((row: any) => row?.updatedAt || row?.requestedAt)),
      });
    })(),
    (async () => {
      const mainSpecial = special('/equipment/main');
      const specialCategories = new Set<string>();
      for (const menu of menus) {
        const p = String(menu.path || '').replace(/\/$/, '');
        const m = p.match(/^\/equipment\/main\/([^/]+)$/);
        if (!m) continue;
        if (isSpecialAssignee(menu, user)) specialCategories.add(m[1]);
      }
      if (!mainSpecial && specialCategories.size === 0) return;
      if (scopeIds.size === 0) return;

      const scopeNames = new Set(
        units
          .filter((u) => scopeIds.has(u.id))
          .map((u) => String(u.unit_name || '').trim())
          .filter(Boolean)
      );

      const rows = await prisma.equipment.findMany({
        where: { status: '정상', archived_at: null },
        select: {
          name: true,
          asset_no: true,
          status: true,
          archived_at: true,
          category: true,
          unit_id: true,
          department: true,
          calib_cycle_mo: true,
          next_calib_date: true,
          calib_applicable: true,
          updatedAt: true,
          histories: {
            select: { calib_date: true, calib_request_date: true },
          },
        },
      });

      let count = 0;
      let latestAt = 0;
      for (const eq of rows) {
        if (!isActiveEquipmentRow(eq)) continue;
        const uid = String(eq.unit_id || '').trim();
        const dept = String(eq.department || '').trim();
        const inScope = uid ? scopeIds.has(uid) : Boolean(dept && scopeNames.has(dept));
        if (!inScope) continue;
        const cat = String(eq.category || '').trim();
        if (!mainSpecial && !specialCategories.has(cat)) continue;
        const sched = resolveCalibSchedule(eq);
        if (!sched.isDue) continue;
        count += 1;
        latestAt = maxAt(latestAt, eq.updatedAt, sched.nCalib);
      }

      pushAlarm(alarms, {
        id: 'equip-calib',
        label: '[현장장비] 검교정 일정 확인',
        count,
        href: '/equipment/main',
        at: latestAt,
      });
    })(),
    (async () => {
      if (!special('/marketing/distribution/dept')) return;
      const mgmt = isGlobalMgmtOrgMember({
        myUnitName: unitName,
        myUnitId: unitId,
        globalMgmtDept: config?.global_mgmt_dept,
        units,
      });
      if (!mgmt) return;
      const rows = await prisma.marketingDistribution.findMany({
        where: { status: 'PENDING' },
        select: { createdAt: true },
      });
      pushAlarm(alarms, {
        id: 'mkt-pending',
        label: '[마케팅] 물품 지급 대기',
        count: rows.length,
        href: '/marketing/distribution/dept',
        at: maxAt(...rows.map((r) => r.createdAt)),
      });
    })(),
    (async () => {
      const rows = await prisma.supplyRequest.findMany({
        where: { user_email: { equals: email, mode: 'insensitive' }, status: 'READY' },
        select: { updatedAt: true, createdAt: true },
      });
      pushAlarm(alarms, {
        id: 'supply-ready',
        label: '[소모품] 물품 수령 대기',
        count: rows.length,
        href: '/asset/supplies/dept',
        at: maxAt(...rows.map((r) => maxAt(r.updatedAt, r.createdAt))),
      });
    })(),
    (async () => {
      const rows = await prisma.iTRequest.findMany({
        where: {
          requester_email: { equals: email, mode: 'insensitive' },
          status: { in: ['관리자 의견발송', '관리자 답변'] },
        },
        select: { updatedAt: true, createdAt: true },
      });
      pushAlarm(alarms, {
        id: 'it-opinion',
        label: '[IT자산] 관리자 의견 도착',
        count: rows.length,
        href: '/asset/it/personal',
        at: maxAt(...rows.map((r) => maxAt(r.updatedAt, r.createdAt))),
      });
    })(),
    (async () => {
      const rows = await prisma.iTAsset.findMany({
        where: {
          is_active: true,
          user_email: { equals: email, mode: 'insensitive' },
          audit_request_date: { not: null },
        },
        select: { audit_request_date: true, updatedAt: true },
      });
      pushAlarm(alarms, {
        id: 'it-nudge',
        label: '[IT자산] 실사 참여 요청',
        count: rows.length,
        href: '/asset/it/personal',
        at: maxAt(...rows.map((r) => maxAt(r.audit_request_date, r.updatedAt))),
      });
    })(),
    (async () => {
      // 본인 대상 실사(진행중) — 미실사 자산이 있을 때만 /asset/it/personal
      // D-3 구간이면 「실사 마감 임박」, 그 외에는 「신규 실사 안내」(둘 중 하나만)
      const audits = await prisma.iTAudit.findMany({
        where: { status: '진행중' },
        select: {
          id: true,
          startDate: true,
          endDate: true,
          endTime: true,
          target: true,
          target_unit_ids: true,
          postDate: true,
          updatedAt: true,
          createdAt: true,
        },
      });
      const mine = audits
        .filter(
          (a) =>
            !isPastKSTDeadline(a.endDate, a.endTime) &&
            userMatchesAuditTarget({
              userUnitId: unitId,
              userDeptName: unitName,
              target: a.target,
              targetUnitIds: a.target_unit_ids,
              units,
            })
        )
        .sort((a, b) => String(a.endDate || '').localeCompare(String(b.endDate || '')));
      if (mine.length === 0) return;

      const assets = await prisma.iTAsset.findMany({
        where: {
          is_active: true,
          user_email: { equals: email, mode: 'insensitive' },
        },
        select: {
          dept: true,
          unit_id: true,
          last_audit_date: true,
          updatedAt: true,
        },
      });

      let pendingCount = 0;
      let d3PendingCount = 0;
      let pendingAt = 0;
      for (const asset of assets) {
        const covering = mine.filter((a) =>
          assetInAuditTarget(
            { dept: asset.dept, unit_id: asset.unit_id },
            a.target,
            units,
            a.target_unit_ids
          )
        );
        if (covering.length === 0) continue;
        const primary = covering[0];
        const lastAudit = String(asset.last_audit_date || '');
        const verified = !!lastAudit && lastAudit >= String(primary.startDate || '');
        if (verified) continue;
        pendingCount += 1;
        const daysLeft = getKSTDaysUntil(String(primary.endDate || '').slice(0, 10));
        if (daysLeft >= 0 && daysLeft <= 3) d3PendingCount += 1;
        const at = toAt(asset.updatedAt);
        if (at > pendingAt) pendingAt = at;
      }
      if (pendingCount <= 0) return;

      if (d3PendingCount > 0) {
        pushAlarm(alarms, {
          id: 'it-audit-d3',
          label: '[IT자산] 실사 마감 임박 (D-3)',
          count: d3PendingCount,
          href: '/asset/it/personal',
          at: maxAt(
            pendingAt,
            ...mine
              .filter((a) => {
                const days = getKSTDaysUntil(String(a.endDate || '').slice(0, 10));
                return days >= 0 && days <= 3;
              })
              .map((a) => maxAt(a.updatedAt, a.createdAt, a.endDate, a.postDate))
          ),
        });
        return;
      }

      pushAlarm(alarms, {
        id: 'it-audit-new',
        label: '[IT자산] 신규 실사 안내',
        count: pendingCount,
        href: '/asset/it/personal',
        at: maxAt(
          pendingAt,
          ...mine.map((a) => maxAt(a.postDate, a.updatedAt, a.createdAt))
        ),
      });
    })(),
    (async () => {
      // my-page 표시 「수령대기」중 사무실 수령 후(DB 수령완료)만 — 발주완료(외주 제작중)는 제외
      const rows = await prisma.businessCardRequest.findMany({
        where: {
          isArchived: false,
          userEmail: { equals: email, mode: 'insensitive' },
          adminStatus: '수령완료',
        },
        select: { updatedAt: true, createdAt: true },
      });
      pushAlarm(alarms, {
        id: 'bc-receive',
        label: '[명함] 명함 수령 대기',
        count: rows.length,
        href: '/asset/businesscard/my-page',
        at: maxAt(...rows.map((r) => maxAt(r.updatedAt, r.createdAt))),
      });
    })(),
    (async () => {
      // apply/history 「수령완료」(VERIFIED) · inspection에서 명세대조(보관) 이동 전
      const rows = await prisma.productionRequest.findMany({
        where: {
          isArchived: false,
          status: 'VERIFIED',
          userEmail: { equals: email, mode: 'insensitive' },
        },
        select: { updatedAt: true, createdAt: true },
      });
      pushAlarm(alarms, {
        id: 'prod-receive',
        label: '[제작물] 물품 수령 대기',
        count: rows.length,
        href: '/asset/production/apply/history',
        at: maxAt(...rows.map((r) => maxAt(r.updatedAt, r.createdAt))),
      });
    })(),
    (async () => {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const rows = await prisma.marketingDistribution.findMany({
        where: {
          status: 'CONFIRMED',
          approved_at: { gte: since },
          sender_email: { equals: email, mode: 'insensitive' },
        },
        select: { approved_at: true, createdAt: true },
      });
      pushAlarm(alarms, {
        id: 'mkt-approved',
        label: '[마케팅] 신청 승인 완료',
        count: rows.length,
        href: '/marketing/distribution/register',
        at: maxAt(...rows.map((r) => maxAt(r.approved_at, r.createdAt))),
      });
    })(),
    (async () => {
      const buckets = await surveyBuckets('delivery');
      pushAlarm(alarms, {
        id: 'sv-del-nudge',
        label: '[설문/배송] 설문 참여 요청',
        count: buckets.nudge,
        href: '/survey/delivery/dashboard',
        at: buckets.nudgeAt,
      });
      pushAlarm(alarms, {
        id: 'sv-del-d3',
        label: '[설문/배송] 설문 마감 임박 (D-3)',
        count: buckets.d3,
        href: '/survey/delivery/dashboard',
        at: buckets.d3At,
      });
      pushAlarm(alarms, {
        id: 'sv-del-open',
        label: '[설문/배송] 신규 설문 게시',
        count: buckets.open,
        href: '/survey/delivery/dashboard',
        at: buckets.openAt,
      });
    })(),
    (async () => {
      // admin/interface Master · Task Access · Task Editor 만 (일반 Edit LV 제외)
      // 상시/기간 대기함 = 제출·미승인 + (보완 없거나 재제출 후 재대기)
      if (!special('/survey/delivery/admin/active-surveys')) return;
      const surveys = await prisma.deliverySurvey.findMany({
        where: { status: { not: '보관됨' } },
        select: { id: true, deliveryType: true },
      });
      const alwaysIds = surveys.filter((s) => s.deliveryType === 'ALWAYS').map((s) => s.id);
      const periodIds = surveys.filter((s) => s.deliveryType === 'PERIOD').map((s) => s.id);

      const countAwaitingReview = async (ids: string[]) => {
        if (ids.length === 0) return { count: 0, at: 0 };
        const rows = await prisma.deliveryResponse.findMany({
          where: { surveyId: { in: ids }, isApproved: false },
          select: { submittedAt: true, feedbackAt: true },
        });
        let count = 0;
        let at = 0;
        for (const r of rows) {
          const submitMs = toAt(r.submittedAt);
          if (!r.feedbackAt) {
            count += 1;
            if (submitMs > at) at = submitMs;
            continue;
          }
          const feedbackMs = toAt(r.feedbackAt);
          // 재제출(제출 시각 > 보완 시각) → 다시 대기함에 포함
          if (feedbackMs < submitMs) {
            count += 1;
            if (submitMs > at) at = submitMs;
          }
        }
        return { count, at };
      };

      const [always, period] = await Promise.all([
        countAwaitingReview(alwaysIds),
        countAwaitingReview(periodIds),
      ]);
      pushAlarm(alarms, {
        id: 'sv-del-pending-always',
        label: '[설문/배송] 상시신청 신규 접수',
        count: always.count,
        href: '/survey/delivery/admin/active-surveys',
        at: always.at,
      });
      pushAlarm(alarms, {
        id: 'sv-del-pending-period',
        label: '[설문/배송] 기간신청 신규 접수',
        count: period.count,
        href: '/survey/delivery/admin/active-surveys',
        at: period.at,
      });
    })(),
    (async () => {
      // 전직원 — my-submissions 「보완 필요」와 동일: 미승인 + 보완의견이 최신 제출 이후
      if (!email) return;
      const rows = await prisma.deliveryResponse.findMany({
        where: {
          userEmail: { equals: email, mode: 'insensitive' },
          isApproved: false,
          OR: [{ isRevoked: true }, { feedbackMsg: { not: null } }],
        },
        select: {
          surveyId: true,
          submittedAt: true,
          feedbackAt: true,
          feedbackMsg: true,
          isRevoked: true,
        },
      });
      if (rows.length === 0) return;

      const surveyIds = Array.from(new Set(rows.map((r) => r.surveyId)));
      const openSurveys = await prisma.deliverySurvey.findMany({
        where: {
          id: { in: surveyIds },
          status: { notIn: ['완료', '보관됨'] },
        },
        select: { id: true },
      });
      const openSet = new Set(openSurveys.map((s) => s.id));

      let count = 0;
      let at = 0;
      for (const r of rows) {
        if (!openSet.has(r.surveyId)) continue;
        const msg = String(r.feedbackMsg || '').trim();
        if (!msg && !r.isRevoked) continue;
        const submitMs = toAt(r.submittedAt);
        const feedbackMs = toAt(r.feedbackAt);
        // 제출 이후 보완이 남아 있는 경우만 (재제출로 보완 해소되면 제외)
        if (r.feedbackAt && feedbackMs < submitMs) continue;
        count += 1;
        const t = Math.max(feedbackMs, submitMs);
        if (t > at) at = t;
      }
      pushAlarm(alarms, {
        id: 'sv-del-feedback',
        label: '[설문/배송] 관리자 보완 요청',
        count,
        href: '/survey/delivery/my-submissions',
        at,
      });
    })(),
    (async () => {
      const buckets = await surveyBuckets('general');
      pushAlarm(alarms, {
        id: 'sv-gen-nudge',
        label: '[설문/일반] 설문 참여 요청',
        count: buckets.nudge,
        href: '/survey/general/dashboard',
        at: buckets.nudgeAt,
      });
      pushAlarm(alarms, {
        id: 'sv-gen-d3',
        label: '[설문/일반] 설문 마감 임박 (D-3)',
        count: buckets.d3,
        href: '/survey/general/dashboard',
        at: buckets.d3At,
      });
      pushAlarm(alarms, {
        id: 'sv-gen-open',
        label: '[설문/일반] 신규 설문 게시',
        count: buckets.open,
        href: '/survey/general/dashboard',
        at: buckets.openAt,
      });
    })(),
  ]);

  // 최신 발생이 위로 (등록·도착 역순 스택)
  alarms.sort((a, b) => b.at - a.at || a.label.localeCompare(b.label, 'ko'));
  return alarms.filter((a) => !isAlarmSnoozedNow(snoozes, a.id));

  async function surveyBuckets(kind: 'delivery' | 'general') {
    const empty = { nudge: 0, d3: 0, open: 0, nudgeAt: 0, d3At: 0, openAt: 0 };
    const surveys =
      kind === 'delivery'
        ? await prisma.deliverySurvey.findMany({
            where: { status: '진행중' },
            select: {
              id: true,
              target: true,
              target_unit_ids: true,
              endDate: true,
              endTime: true,
              nudgedUsers: true,
              status: true,
              createdAt: true,
              updatedAt: true,
            },
          })
        : await prisma.generalSurvey.findMany({
            where: { status: '진행중' },
            select: {
              id: true,
              target: true,
              target_unit_ids: true,
              endDate: true,
              endTime: true,
              nudgedUsers: true,
              status: true,
              createdAt: true,
              updatedAt: true,
            },
          });
    const openRows = surveys.filter(
      (s) => s.status === '진행중' && !isPastKSTDeadline(s.endDate, s.endTime) && surveyTargeted(s)
    );
    if (openRows.length === 0) return empty;
    const ids = openRows.map((s) => s.id);
    const answered =
      kind === 'delivery'
        ? await prisma.deliveryResponse.findMany({
            where: { surveyId: { in: ids }, userEmail: { equals: email, mode: 'insensitive' }, isRevoked: false },
            select: { surveyId: true },
          })
        : await prisma.generalResponse.findMany({
            where: { surveyId: { in: ids }, userEmail: { equals: email, mode: 'insensitive' } },
            select: { surveyId: true },
          });
    const done = new Set(answered.map((a) => a.surveyId));
    let nudge = 0;
    let d3 = 0;
    let open = 0;
    let nudgeAt = 0;
    let d3At = 0;
    let openAt = 0;
    for (const s of openRows) {
      if (done.has(s.id)) continue;
      const at = maxAt(s.updatedAt, s.createdAt);
      const nudged = asArray(s.nudgedUsers).some((e) => String(e || '').trim().toLowerCase() === emailKey);
      const days = getKSTDaysUntil(String(s.endDate || '').slice(0, 10));
      if (nudged) {
        nudge += 1;
        if (at > nudgeAt) nudgeAt = at;
      } else if (days >= 0 && days <= 3) {
        d3 += 1;
        if (at > d3At) d3At = at;
      } else {
        open += 1;
        if (at > openAt) openAt = at;
      }
    }
    return { nudge, d3, open, nudgeAt, d3At, openAt };
  }
}
