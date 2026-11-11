'use client';

import CorpCardScaffold from '@/components/asset/corp-card/CorpCardScaffold';
import { BoardPanel } from '@/components/asset/corp-card/DeptBoardModule';
import { CORP_CARD_MASTER_TABS } from '@/lib/interface-step-tabs';

export default function MasterMonitoringModule() {
  return (
    <CorpCardScaffold
      titleEn="CORPORATE CARD · MASTER MONITORING"
      title="전사 부서 반출 법인카드 모니터링"
      description="모든 부서의 진행 중인 법인카드 반출·반납 내역을 한곳에서 확인합니다. 반납 완료 건은 반납 이력에서 조회합니다."
      tabs={CORP_CARD_MASTER_TABS}
      tabPrefix="/asset/corp-card/master"
      hideUserName
      bannerTone="emerald"
      showPermissionChips
      menuPath="/asset/corp-card/master/monitoring"
    >
      <BoardPanel variant="monitoring" />
    </CorpCardScaffold>
  );
}
