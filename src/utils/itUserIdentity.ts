/** IT 자산·요청의 사용자 안정 식별 (email / userId 우선, name은 표시·레거시) */

export type ItIdentity = {
  name: string;
  email: string;
  id: string;
  dept?: string;
};

export function normalizeEmail(email: string | null | undefined) {
  return String(email || '').trim().toLowerCase();
}

export function isPlaceholderUserLabel(v: string | null | undefined) {
  const s = String(v || '').trim();
  return !s || s === '-' || s === '공용';
}

/** 세션/User 레코드 → 표준 identity */
export function toItIdentity(user: any | null | undefined): ItIdentity | null {
  if (!user) return null;
  const name = String(user.name || '').trim();
  const email = normalizeEmail(user.email);
  const id = String(user.id || user.userId || '').trim();
  if (!email && !id && !name) return null;
  return {
    name: name || email || id,
    email,
    id,
    dept: String(user.unit?.unit_name || user.dept || '').trim() || undefined,
  };
}

/** 자산 담당자 매칭: user_id → user_email → (레거시) user 이름 */
export function assetMatchesIdentity(asset: any, identity: ItIdentity | null | undefined) {
  if (!asset || !identity) return false;
  const assetId = String(asset.user_id || '').trim();
  if (identity.id && assetId && assetId === identity.id) return true;
  const assetEmail = normalizeEmail(asset.user_email);
  if (identity.email && assetEmail && assetEmail === identity.email) return true;
  // 레거시: email/id 미기록 행만 이름 폴백
  if (!assetEmail && !assetId && identity.name) {
    return String(asset.user || '').trim() === identity.name;
  }
  return false;
}

/** 요청자 매칭: requester_id → requester_email → (레거시) requester 이름 */
export function requestMatchesIdentity(req: any, identity: ItIdentity | null | undefined) {
  if (!req || !identity) return false;
  const reqId = String(req.requester_id || '').trim();
  if (identity.id && reqId && reqId === identity.id) return true;
  const reqEmail = normalizeEmail(req.requester_email);
  if (identity.email && reqEmail && reqEmail === identity.email) return true;
  if (!reqEmail && !reqId && identity.name) {
    return String(req.requester || '').trim() === identity.name;
  }
  return false;
}

/** Prisma where OR for ITAsset owned by identity */
export function prismaAssetOwnerWhere(identity: ItIdentity) {
  const or: any[] = [];
  if (identity.id) or.push({ user_id: identity.id });
  if (identity.email) or.push({ user_email: identity.email });
  // 레거시 행: email/id null 이고 이름만 있는 경우
  if (identity.name) {
    or.push({
      AND: [
        { OR: [{ user_email: null }, { user_email: '' }] },
        { OR: [{ user_id: null }, { user_id: '' }] },
        { user: identity.name },
      ],
    });
  }
  return or.length ? { OR: or } : { id: '__none__' };
}

/** Prisma where OR for ITRequest by identity */
export function prismaRequesterWhere(identity: ItIdentity) {
  const or: any[] = [];
  if (identity.id) or.push({ requester_id: identity.id });
  if (identity.email) or.push({ requester_email: identity.email });
  if (identity.name) {
    or.push({
      AND: [
        { OR: [{ requester_email: null }, { requester_email: '' }] },
        { OR: [{ requester_id: null }, { requester_id: '' }] },
        { requester: identity.name },
      ],
    });
  }
  return or.length ? { OR: or } : { id: '__none__' };
}

/** 자산 create/update payload에 identity 필드 채우기 */
export function applyIdentityToAssetPayload(
  payload: Record<string, any>,
  identity: ItIdentity | null | undefined
) {
  if (!identity) return payload;
  if (identity.name) payload.user = identity.name;
  if (identity.email) payload.user_email = identity.email;
  if (identity.id) payload.user_id = identity.id;
  return payload;
}

/** 요청 create payload에 identity 필드 채우기 */
export function applyIdentityToRequestPayload(
  payload: Record<string, any>,
  identity: ItIdentity | null | undefined
) {
  if (!identity) return payload;
  if (identity.name) payload.requester = identity.name;
  if (identity.email) payload.requester_email = identity.email;
  if (identity.id) payload.requester_id = identity.id;
  if (identity.dept && !payload.dept) payload.dept = identity.dept;
  return payload;
}
