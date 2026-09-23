/** 홈 알람 확인(seen)·삭제(dismiss) 스냅샷 — 서버·클라이언트 공용 */

export type AlarmStamp = { count: number; at: number };
export type AlarmCountStamp = Record<string, AlarmStamp>;

function toStamp(raw: unknown): AlarmStamp | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // 구형식: at(ms)만 있던 경우 → 무시
    if (raw > 1e11) return null;
    // 구형식: 건수만 저장 — at=0 이면 건수 비교만(하위호환)
    return { count: Math.max(0, Math.floor(raw)), at: 0 };
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const count = Number((raw as { count?: unknown }).count);
    const at = Number((raw as { at?: unknown }).at);
    if (!Number.isFinite(count) || count < 0) return null;
    return {
      count: Math.floor(count),
      at: Number.isFinite(at) && at > 0 ? Math.floor(at) : 0,
    };
  }
  return null;
}

export function parseAlarmCountMap(raw: unknown): AlarmCountStamp {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const out: AlarmCountStamp = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const id = String(k || '').trim();
    if (!id) continue;
    const stamp = toStamp(v);
    if (!stamp) continue;
    out[id] = stamp;
  }
  return out;
}

export function stampOf(item: { count?: unknown; at?: unknown }): AlarmStamp {
  const countRaw = Number(item.count);
  const atRaw = Number(item.at);
  return {
    count: Number.isFinite(countRaw) && countRaw >= 0 ? Math.floor(countRaw) : 0,
    at: Number.isFinite(atRaw) && atRaw > 0 ? Math.floor(atRaw) : 0,
  };
}

/** 신규(노랑): 확인 기록이 없거나, 건수·최신활동(at)이 늘었으면 */
export function isAlarmFresh(
  item: { id: string; count: number; at?: number },
  seen: AlarmCountStamp
) {
  const prev = seen[item.id];
  if (!prev) return true;
  const cur = stampOf(item);
  if (cur.count > prev.count) return true;
  // at=0 구형식 확인 → 건수만 비교(재로그인 시 at로 풀리지 않음)
  if (prev.at <= 0) return false;
  return cur.at > prev.at;
}

/**
 * ✕ 삭제: 삭제 시점 건수 이하 + 활동시각(at) 이하이면 숨김.
 * 재제출처럼 건수는 같아도 at가 커지면 다시 표시.
 * 구형식(at=0): 건수만 비교 — 대기 0건 시 prune으로 재표시.
 */
export function isAlarmDismissed(
  item: { id: string; count: number; at?: number },
  dismissed: AlarmCountStamp
) {
  const prev = dismissed[item.id];
  if (!prev) return false;
  const cur = stampOf(item);
  if (cur.count > prev.count) return false;
  if (prev.at <= 0) return cur.count <= prev.count;
  return cur.at <= prev.at;
}

export function serializeAlarmCountMap(
  map: AlarmCountStamp
): Record<string, AlarmStamp> {
  const out: Record<string, AlarmStamp> = {};
  for (const [k, v] of Object.entries(map)) {
    const id = String(k || '').trim();
    if (!id || !v) continue;
    const count = Number(v.count);
    const at = Number(v.at);
    if (!Number.isFinite(count) || count < 0) continue;
    out[id] = {
      count: Math.floor(count),
      at: Number.isFinite(at) && at > 0 ? Math.floor(at) : 0,
    };
  }
  return out;
}

/** 건수·at 각각 더 큰 쪽을 유지(확인/삭제 유실 방지) */
export function mergeCountMaps(
  a: AlarmCountStamp,
  b: AlarmCountStamp
): AlarmCountStamp {
  const out: AlarmCountStamp = { ...a };
  for (const [id, stamp] of Object.entries(b)) {
    const prev = out[id];
    if (!prev) {
      out[id] = stamp;
      continue;
    }
    out[id] = {
      count: Math.max(prev.count, stamp.count),
      at: Math.max(prev.at || 0, stamp.at || 0),
    };
  }
  return out;
}

/**
 * 현재 목록에 없는(대기 0건) 알람의 seen/dismiss 스탬프 제거.
 * 보완→재제출처럼 1→0→1 이 되어도 ✕ 삭제가 남지 않게 함.
 */
export function pruneStampsToActive(
  stamps: AlarmCountStamp,
  activeIds: Iterable<string>
): AlarmCountStamp {
  const active = new Set(
    Array.from(activeIds, (id) => String(id || '').trim()).filter(Boolean)
  );
  const out: AlarmCountStamp = {};
  for (const [id, stamp] of Object.entries(stamps)) {
    if (active.has(id)) out[id] = stamp;
  }
  return out;
}

export function mapsDiffer(a: AlarmCountStamp, b: AlarmCountStamp) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const x = a[k];
    const y = b[k];
    if (!x && !y) continue;
    if (!x || !y) return true;
    if (x.count !== y.count || (x.at || 0) !== (y.at || 0)) return true;
  }
  return false;
}
