import { toSortableTime } from '@/utils/dateUtils';

/** IT 의견 대장과 동일: 진행상태 신규접수 = 스레드가 아직 상대 응답·종결 전 */

function reqTime(r: any) {
  return toSortableTime(r?.createdAt || r?.requestDate || 0);
}

function isClosedStatus(status: string) {
  return status === '처리완료' || status === '관리자 확인완료' || status === '사용자 종료처리';
}

function isAdminInquiryRow(req: any) {
  if (!req) return false;
  const s = String(req.status || '').trim();
  if (s === '관리자 의견발송' || s === '사용자 확인완료') return true;
  if (s === '관리자 답변') return false;
  if (s === '답변회신' || String(req.adminOpinion || '').includes(':::REPLY:::')) return false;
  if (s === '의견전송' || s === '답변 대기중' || s === '대기중') return false;
  const content = String(req.content || '').trim();
  const hasUserContent = !!content && content !== '(관리자 의견)';
  const adminText = String(req.adminOpinion || '').split(':::')[0].trim();
  if (!hasUserContent && adminText) return true;
  return false;
}

function sameAssetCode(a: any, b: any) {
  const codeA = String(a?.assetCode || a?.code || '').trim();
  const codeB = String(b?.assetCode || b?.code || '').trim();
  if (!codeA || codeA !== codeB) return false;
  const typeA = String(a?.assetType || a?.category || '').trim() || '일반';
  const typeB = String(b?.assetType || b?.category || '').trim() || '일반';
  return typeA === typeB;
}

function hasMeaningfulUserContent(req: any) {
  const c = String(req?.content || '').trim();
  return !!c && c !== '(관리자 의견)';
}

function hasMeaningfulAdminContent(req: any) {
  const text = String(req?.adminOpinion || '').split(':::')[0].trim();
  return !!text;
}

function isThreadClosed(root: any, children: any[] = []) {
  const members = [root, ...(children || [])].filter(Boolean);
  if (members.length === 0) return false;
  const latest = [...members].sort((a, b) => {
    const d = reqTime(b) - reqTime(a);
    if (d !== 0) return d;
    return String(b.id || '').localeCompare(String(a.id || ''));
  })[0];
  return isClosedStatus(String(latest?.status || ''));
}

function threadStage(root: any, children: any[] = []): 'NEW' | 'IN_PROGRESS' | 'DONE' {
  if (isThreadClosed(root, children)) return 'DONE';
  const members = [root, ...(children || [])].filter(Boolean);
  if (isAdminInquiryRow(root)) {
    return members.some((m) => hasMeaningfulUserContent(m)) ? 'IN_PROGRESS' : 'NEW';
  }
  return members.some((m) => hasMeaningfulAdminContent(m)) ? 'IN_PROGRESS' : 'NEW';
}

function getThreadParentId(req: any, allRequests: any[]): string | null {
  if (!req) return null;
  const status = String(req.status || '').trim();
  if (status === '관리자 의견발송' || status === '사용자 확인완료') return null;
  const prior = allRequests
    .filter((r) => sameAssetCode(r, req) && String(r.id) !== String(req.id) && reqTime(r) <= reqTime(req))
    .sort((a, b) => {
      const d = reqTime(b) - reqTime(a);
      if (d !== 0) return d;
      return String(b.id || '').localeCompare(String(a.id || ''));
    })[0];
  if (!prior) return null;

  const isReplyFlag = status === '답변회신' || String(req.adminOpinion || '').includes(':::REPLY:::');
  const userText = String(req.content || '').trim();
  const hasUserContent = !!userText && userText !== '(관리자 의견)';
  const adminText = String(req.adminOpinion || '').split(':::')[0].trim();
  const adminOnly = !hasUserContent && !!adminText;

  let linkStatus = status;
  if (isClosedStatus(status)) {
    if (isReplyFlag) {
      linkStatus = '답변회신';
    } else if (adminOnly) {
      const priorOpenUser =
        prior.status === '의견전송' ||
        prior.status === '답변 대기중' ||
        prior.status === '답변회신' ||
        prior.status === '사용자 확인완료';
      linkStatus = priorOpenUser ? '관리자 답변' : '관리자 의견발송';
    } else if (hasUserContent) {
      linkStatus = '의견전송';
    } else {
      return null;
    }
  }
  if (linkStatus === '관리자 의견발송') return null;

  if ((linkStatus === '의견전송' || linkStatus === '답변 대기중') && !isReplyFlag && isClosedStatus(prior.status)) {
    return null;
  }
  if ((linkStatus === '의견전송' || linkStatus === '답변 대기중') && !isReplyFlag) {
    const priorOk =
      prior.status === '관리자 의견발송' ||
      prior.status === '사용자 확인완료' ||
      prior.status === '관리자 답변' ||
      prior.status === '답변회신';
    if (!priorOk) return null;
  }
  if (
    isReplyFlag ||
    linkStatus === '답변회신' ||
    linkStatus === '관리자 답변' ||
    linkStatus === '의견전송' ||
    linkStatus === '답변 대기중'
  ) {
    return String(prior.id);
  }
  return null;
}

/** 의견/요청 대장 최우측 진행상태가 「신규접수」인 스레드 수 */
export function countItNewReceiptThreads(requests: any[]): number {
  const parentOf = new Map<string, string>();
  requests.forEach((r) => {
    const pid = getThreadParentId(r, requests);
    if (pid) parentOf.set(String(r.id), pid);
  });
  const childrenOf = new Map<string, any[]>();
  const rootOf = (id: string) => {
    let cur = String(id);
    const seen = new Set<string>();
    while (parentOf.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = parentOf.get(cur) as string;
    }
    return cur;
  };
  requests.forEach((r) => {
    const rootId = rootOf(String(r.id));
    if (rootId === String(r.id)) return;
    if (!requests.some((x) => String(x.id) === rootId)) return;
    const list = childrenOf.get(rootId) || [];
    list.push(r);
    childrenOf.set(rootId, list);
  });

  const roots = requests.filter((r) => {
    const pid = parentOf.get(String(r.id));
    return !pid || !requests.some((x) => String(x.id) === pid);
  });

  return roots.filter((root) => threadStage(root, childrenOf.get(String(root.id)) || []) === 'NEW').length;
}
