/**
 * 설문 대상(target / target_unit_ids) ↔ 사용자 소속 매칭
 * - target_unit_ids 비어있지 않으면 id(+하위 포함) 우선
 * - 없으면 target 명칭 CSV / '전사' 폴백
 */

import {
  collectDescendantUnitIds,
  type OrgUnitNode,
} from '@/lib/org-unit-match';

export function parseSurveyTargetUnitIds(raw: unknown): string[] {
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) {
    return Array.from(
      new Set(raw.map((x) => String(x ?? '').trim()).filter(Boolean))
    );
  }
  const s = String(raw).trim();
  if (!s) return [];
  if (s.startsWith('[')) {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) {
        return Array.from(
          new Set(parsed.map((x) => String(x ?? '').trim()).filter(Boolean))
        );
      }
    } catch {
      /* fall through */
    }
  }
  return [];
}

/** 대상 id 집합(+각 노드 하위) — 빈 배열이면 전사로 취급하지 않음 */
export function expandSurveyTargetUnitIds(
  targetUnitIds: string[],
  units: OrgUnitNode[] | null | undefined
): Set<string> {
  const out = new Set<string>();
  for (const id of targetUnitIds) {
    const root = String(id || '').trim();
    if (!root) continue;
    for (const d of collectDescendantUnitIds(root, units)) out.add(d);
  }
  return out;
}

/**
 * 사용자가 설문 대상에 포함되는지
 * - target_unit_ids 비어 있거나 전사: true (전체)
 * - id 목록 있으면 User.unit_id가 확장 집합에 포함
 * - 없으면 target 명칭 CSV + 상위 체인 폴백
 */
export function userInSurveyTarget(opts: {
  userUnitId?: string | null;
  userDeptName?: string | null;
  target?: string | null;
  targetUnitIds?: unknown;
  units?: OrgUnitNode[] | null;
}): boolean {
  const targetStr = String(opts.target || '').trim();
  const ids = parseSurveyTargetUnitIds(opts.targetUnitIds);

  // 전사: target_unit_ids=[] + target='전사' 또는 target만 전사
  if (ids.length === 0) {
    if (!targetStr || targetStr === '전사') return true;
  } else {
    // id 저장 시 전사는 []로 두는 규약 — 비어있지 않으면 id 매칭
    const uid = String(opts.userUnitId || '').trim();
    if (!uid) {
      // unit_id 없는 레거시 유저 → 명칭 폴백
    } else {
      const expanded = expandSurveyTargetUnitIds(ids, opts.units);
      if (expanded.has(uid)) return true;
      return false;
    }
  }

  // 명칭 폴백 (레거시 설문 / unit_id 없는 유저)
  if (!targetStr || targetStr === '전사') return true;
  const userDept = String(opts.userDeptName || '').trim();
  if (!userDept) return false;
  const targetDepts = targetStr.split(',').map((t) => t.trim()).filter(Boolean);
  if (targetDepts.includes(userDept)) return true;

  const units = opts.units || [];
  let current = units.find((u) => String(u.unit_name || '').trim() === userDept);
  while (current?.parent_id) {
    const parent = units.find((u) => String(u.id || '').trim() === String(current!.parent_id));
    if (!parent) break;
    if (targetDepts.includes(String(parent.unit_name || '').trim())) return true;
    current = parent;
  }
  return false;
}
