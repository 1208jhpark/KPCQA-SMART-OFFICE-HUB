export const WORK_STATUSES = ['TODO', 'DOING', 'DONE'] as const;
export type WorkStatus = (typeof WORK_STATUSES)[number];

export type WorkBoardLine = {
  id: string;
  /** 세부분야 */
  area: string;
  assignee_name: string;
  status: WorkStatus;
};

export function normalizeWorkStatus(raw: unknown): WorkStatus | null {
  const s = String(raw || '')
    .trim()
    .toUpperCase();
  return (WORK_STATUSES as readonly string[]).includes(s) ? (s as WorkStatus) : null;
}

/** 세부분야 행 상태로 프로젝트 칸반 열 결정 */
export function deriveProjectStatus(lines: WorkBoardLine[]): WorkStatus {
  if (!lines.length) return 'TODO';
  if (lines.every((l) => l.status === 'DONE')) return 'DONE';
  if (lines.every((l) => l.status === 'DOING')) return 'DOING';
  if (lines.every((l) => l.status === 'TODO')) return 'TODO';
  // 혼재(일부만 진행·완료) → 진행 중
  return 'DOING';
}

export function parseWorkBoardLines(raw: unknown): WorkBoardLine[] {
  let arr: unknown[] = [];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      arr = Array.isArray(parsed) ? parsed : [];
    } catch {
      arr = [];
    }
  } else if (Array.isArray(raw)) {
    arr = raw;
  }

  const lines: WorkBoardLine[] = [];
  for (const row of arr) {
    if (!row || typeof row !== 'object') continue;
    const o = row as Record<string, unknown>;
    const area = String(o.area ?? o.field ?? '').trim().slice(0, 80);
    const assignee = String(o.assignee_name ?? o.assigneeName ?? '').trim().slice(0, 80);
    const status = normalizeWorkStatus(o.status) || 'TODO';
    const id =
      String(o.id || '')
        .trim()
        .slice(0, 40) || `L${lines.length + 1}`;
    // 세부분야·담당자 모두 비어 있으면 행 무시 (선택 입력)
    if (!area && !assignee) continue;
    lines.push({
      id,
      area: area || (assignee ? '세부' : ''),
      assignee_name: assignee,
      status,
    });
  }
  return lines.filter((l) => l.area || l.assignee_name);
}

export function serializeWorkBoardLines(lines: WorkBoardLine[]): string {
  return JSON.stringify(
    lines.map((l) => ({
      id: l.id,
      area: l.area,
      assignee_name: l.assignee_name,
      status: l.status,
    }))
  );
}
