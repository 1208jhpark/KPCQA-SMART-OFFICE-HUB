/** 화면 전환 공통 placeholder — 문구 없이 빈 영역만 (대기감 문구 제거) */
export default function LoadingState() {
  return (
    <div
      className="w-full min-h-[240px] bg-transparent"
      aria-busy="true"
      aria-label="콘텐츠 준비 중"
    />
  );
}
