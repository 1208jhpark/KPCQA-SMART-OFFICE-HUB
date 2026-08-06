/** 모든 스탭 화면 공통 로딩 표기 (위치·크기·문구 통일) */
export default function LoadingState() {
  return (
    <div className="w-full py-24 text-center font-sans">
      <span className="text-[11px] font-black tracking-[0.2em] text-slate-400 animate-pulse">
        Loading...
      </span>
    </div>
  );
}
