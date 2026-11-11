'use client';

import CorpCardScaffold from '@/components/asset/corp-card/CorpCardScaffold';
import { BoardPanel } from '@/components/asset/corp-card/DeptBoardModule';
import { CORP_CARD_MASTER_TABS } from '@/lib/interface-step-tabs';

export default function MasterHistoryModule() {
  return (
    <CorpCardScaffold
      titleEn="CORPORATE CARD · MASTER HISTORY"
      title="법인카드 반납 이력"
      description="반납이 완료된 전사 법인카드 사용 내역입니다."
      tabs={CORP_CARD_MASTER_TABS}
      tabPrefix="/asset/corp-card/master"
      hideUserName
      bannerTone="emerald"
      showPermissionChips
      menuPath="/asset/corp-card/master/history"
    >
      <BoardPanel variant="masterHistory" />
    </CorpCardScaffold>
  );
}
