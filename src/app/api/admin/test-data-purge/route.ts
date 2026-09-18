import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authorizeAdminApi, authErrorToResponse } from '@/lib/server-auth-guard';
import {
  issuePurgeChallenge,
  consumePurgeChallenge,
  isTestDataPurgeAllowed,
  TEST_DATA_PURGE_DOMAINS,
  resolvePurgeDomains,
  type TestDataPurgeDomainId,
} from '@/lib/test-data-purge';

export const dynamic = 'force-dynamic';

type CountMap = Record<string, number>;

async function countDomain(id: TestDataPurgeDomainId): Promise<CountMap> {
  switch (id) {
    case 'production_requests':
      return { ProductionRequest: await prisma.productionRequest.count() };
    case 'supplies_requests':
      return { SupplyRequest: await prisma.supplyRequest.count() };
    case 'supplies_purchases':
      return { SupplyPurchase: await prisma.supplyPurchase.count() };
    case 'it_requests':
      return { ITRequest: await prisma.iTRequest.count() };
    case 'it_audits':
      return {
        ITAuditResponse: await prisma.iTAuditResponse.count(),
        ITAudit: await prisma.iTAudit.count(),
      };
    case 'it_asset_archive':
      return { ITAssetArchive: await prisma.iTAssetArchive.count() };
    case 'business_card':
      return {
        BusinessCardRequest: await prisma.businessCardRequest.count(),
        BusinessCardOrderBatch: await prisma.businessCardOrderBatch.count(),
      };
    case 'marketing_distributions':
      return { MarketingDistribution: await prisma.marketingDistribution.count() };
    case 'marketing_purchases':
      return { MarketingPurchase: await prisma.marketingPurchase.count() };
    case 'delivery_responses':
      return {
        DeliveryResponseEvent: await prisma.deliveryResponseEvent.count(),
        DeliveryResponse: await prisma.deliveryResponse.count(),
      };
    case 'general_responses':
      return { GeneralResponse: await prisma.generalResponse.count() };
    case 'equipment_histories':
      return {
        CalibrationHistory: await prisma.calibrationHistory.count(),
        MaintenanceHistory: await prisma.maintenanceHistory.count(),
      };
    default:
      return {};
  }
}

async function purgeDomain(id: TestDataPurgeDomainId): Promise<CountMap> {
  const deleted: CountMap = {};

  switch (id) {
    case 'production_requests': {
      const r = await prisma.productionRequest.deleteMany({});
      deleted.ProductionRequest = r.count;
      break;
    }
    case 'supplies_requests': {
      const r = await prisma.supplyRequest.deleteMany({});
      deleted.SupplyRequest = r.count;
      break;
    }
    case 'supplies_purchases': {
      const purchases = await prisma.supplyPurchase.findMany({
        select: { item_id: true, qty: true },
      });
      const qtyByItem = new Map<string, number>();
      for (const p of purchases) {
        qtyByItem.set(p.item_id, (qtyByItem.get(p.item_id) || 0) + Math.max(0, Number(p.qty) || 0));
      }
      const r = await prisma.supplyPurchase.deleteMany({});
      deleted.SupplyPurchase = r.count;

      let stockAdjusted = 0;
      for (const [itemId, inboundQty] of qtyByItem) {
        if (inboundQty <= 0) continue;
        const item = await prisma.supplyItem.findUnique({
          where: { id: itemId },
          select: { current_stock: true },
        });
        if (!item) continue;
        const next = Math.max(0, Number(item.current_stock || 0) - inboundQty);
        await prisma.supplyItem.update({
          where: { id: itemId },
          data: { current_stock: next },
        });
        stockAdjusted += 1;
      }
      deleted.SupplyItem_stock_adjusted = stockAdjusted;
      break;
    }
    case 'it_requests': {
      const r = await prisma.iTRequest.deleteMany({});
      deleted.ITRequest = r.count;
      break;
    }
    case 'it_audits': {
      const resp = await prisma.iTAuditResponse.deleteMany({});
      const aud = await prisma.iTAudit.deleteMany({});
      deleted.ITAuditResponse = resp.count;
      deleted.ITAudit = aud.count;
      break;
    }
    case 'it_asset_archive': {
      const r = await prisma.iTAssetArchive.deleteMany({});
      deleted.ITAssetArchive = r.count;
      break;
    }
    case 'business_card': {
      await prisma.businessCardRequest.updateMany({ data: { orderGroupId: null } });
      const req = await prisma.businessCardRequest.deleteMany({});
      const batch = await prisma.businessCardOrderBatch.deleteMany({});
      deleted.BusinessCardRequest = req.count;
      deleted.BusinessCardOrderBatch = batch.count;
      break;
    }
    case 'marketing_distributions': {
      const r = await prisma.marketingDistribution.deleteMany({});
      deleted.MarketingDistribution = r.count;
      break;
    }
    case 'marketing_purchases': {
      const purchases = await prisma.marketingPurchase.findMany({
        select: { item_id: true, qty: true },
      });
      const qtyByItem = new Map<string, number>();
      for (const p of purchases) {
        qtyByItem.set(p.item_id, (qtyByItem.get(p.item_id) || 0) + Math.max(0, Number(p.qty) || 0));
      }
      const r = await prisma.marketingPurchase.deleteMany({});
      deleted.MarketingPurchase = r.count;

      let stockAdjusted = 0;
      for (const [itemId, inboundQty] of qtyByItem) {
        if (inboundQty <= 0) continue;
        const item = await prisma.marketingItem.findUnique({
          where: { id: itemId },
          select: { current_stock: true },
        });
        if (!item) continue;
        const next = Math.max(0, Number(item.current_stock || 0) - inboundQty);
        await prisma.marketingItem.update({
          where: { id: itemId },
          data: { current_stock: next },
        });
        stockAdjusted += 1;
      }
      deleted.MarketingItem_stock_adjusted = stockAdjusted;
      break;
    }
    case 'delivery_responses': {
      const ev = await prisma.deliveryResponseEvent.deleteMany({});
      const resp = await prisma.deliveryResponse.deleteMany({});
      deleted.DeliveryResponseEvent = ev.count;
      deleted.DeliveryResponse = resp.count;
      break;
    }
    case 'general_responses': {
      const r = await prisma.generalResponse.deleteMany({});
      deleted.GeneralResponse = r.count;
      break;
    }
    case 'equipment_histories': {
      const cal = await prisma.calibrationHistory.deleteMany({});
      const m = await prisma.maintenanceHistory.deleteMany({});
      deleted.CalibrationHistory = cal.count;
      deleted.MaintenanceHistory = m.count;
      break;
    }
    default:
      break;
  }

  return deleted;
}

/** [GET] 도메인별 건수 미리보기 + 일회용 확인 키 발급 — LV_1 */
export async function GET() {
  try {
    const user = await authorizeAdminApi();

    if (!isTestDataPurgeAllowed()) {
      return NextResponse.json(
        {
          enabled: false,
          message:
            '테스트 일괄삭제가 비활성입니다. .env 의 ALLOW_TEST_DELETE=true 후 서버를 재시작하세요.',
        },
        { status: 200, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const domains = [];
    for (const def of TEST_DATA_PURGE_DOMAINS) {
      const counts = await countDomain(def.id);
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      domains.push({ ...def, counts, total });
    }

    const challenge = issuePurgeChallenge(String(user.id));

    return NextResponse.json(
      {
        enabled: true,
        challengeId: challenge.challengeId,
        challengeCode: challenge.challengeCode,
        challengeExpiresInSec: challenge.expiresInSec,
        excludedNote:
          '마스터·시드·메뉴권한·설문정의·품목/자산/장비 본체·고객사·외주업체는 삭제하지 않습니다.',
        domains,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('test-data-purge GET:', error);
    return NextResponse.json({ message: '미리보기 조회 실패' }, { status: 500 });
  }
}

/**
 * [POST] 선택한 도메인만 삭제 — LV_1
 * body: { domainIds: string[], challengeId: string, confirm: string }
 */
export async function POST(req: Request) {
  try {
    const user = await authorizeAdminApi();

    if (!isTestDataPurgeAllowed()) {
      return NextResponse.json(
        {
          message:
            '테스트 일괄삭제가 비활성입니다. (.env ALLOW_TEST_DELETE)',
        },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const consumed = consumePurgeChallenge(
      String(body.challengeId || ''),
      String(body.confirm || ''),
      String(user.id)
    );
    if (!consumed.ok) {
      return NextResponse.json({ message: consumed.message }, { status: 400 });
    }

    const selected = resolvePurgeDomains(body.domainIds);
    if (selected.length === 0) {
      return NextResponse.json(
        { message: '삭제할 페이지(도메인)를 하나 이상 선택해 주세요.' },
        { status: 400 }
      );
    }

    const results: Array<{
      id: string;
      label: string;
      deleted: CountMap;
    }> = [];

    for (const def of selected) {
      const deleted = await purgeDomain(def.id);
      results.push({ id: def.id, label: def.label, deleted });
    }

    const totalDeleted = results.reduce(
      (sum, r) =>
        sum +
        Object.entries(r.deleted)
          .filter(([k]) => !k.endsWith('_stock_reset') && !k.endsWith('_stock_adjusted'))
          .reduce((a, [, n]) => a + n, 0),
      0
    );

    return NextResponse.json({
      message: `선택한 ${selected.length}개 영역에서 거래 행 ${totalDeleted}건을 삭제했습니다.`,
      totalDeleted,
      results,
    });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('test-data-purge POST:', error);
    return NextResponse.json({ message: '삭제 처리 실패' }, { status: 500 });
  }
}
