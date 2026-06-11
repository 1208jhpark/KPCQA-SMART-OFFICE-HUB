import AssetArchive from '../../../../../../components/asset/it/MasterArchiveModule';

export default function ItMasterArchivePage() {
  return (
    <div className="animate-fade-in">
      {/* 쪼개둔 3번 컴포넌트(아카이브)를 단일 화면으로 불러옵니다 */}
      <AssetArchive />
    </div>
  );
}