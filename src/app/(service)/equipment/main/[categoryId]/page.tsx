import { redirect } from "next/navigation";

export default async function EquipmentCategoryGateway({
  params,
}: {
  params: Promise<{ categoryId: string }>;
}) {
  // Next.js 15 규격: params를 비동기(Promise)로 안전하게 언래핑합니다.
  const resolvedParams = await params;
  
  // 카테고리 카드를 클릭하고 들어왔을 때, 기본 탭인 '활성 장비(inventory)' 뷰로 강제 연결합니다.
  redirect(`/equipment/main/${resolvedParams.categoryId}/inventory`);
}