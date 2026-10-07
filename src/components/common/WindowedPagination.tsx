'use client';

type WindowedPaginationProps = {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  /** 한 구간에 보여줄 페이지 버튼 수 */
  windowSize?: number;
  className?: string;
};

/**
 * 페이지 번호를 전부 나열하지 않고 windowSize(기본 10)개씩 보여 줍니다.
 * « » 로 다음/이전 구간 이동.
 */
export default function WindowedPagination({
  currentPage,
  totalPages,
  onPageChange,
  windowSize = 10,
  className = '',
}: WindowedPaginationProps) {
  const safeTotal = Math.max(1, totalPages);
  const safeCurrent = Math.min(Math.max(1, currentPage), safeTotal);
  const windowStart =
    Math.floor((safeCurrent - 1) / windowSize) * windowSize + 1;
  const windowEnd = Math.min(windowStart + windowSize - 1, safeTotal);
  const pageNums = Array.from(
    { length: windowEnd - windowStart + 1 },
    (_, i) => windowStart + i
  );

  const btnBase =
    'px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors';

  return (
    <div
      className={`flex flex-wrap justify-center items-center gap-1.5 py-3 border-t border-slate-100 bg-white ${className}`}
    >
      <button
        type="button"
        disabled={windowStart <= 1}
        onClick={() => onPageChange(Math.max(1, windowStart - windowSize))}
        title={`이전 ${windowSize}페이지`}
        className={btnBase}
      >
        «
      </button>
      <button
        type="button"
        disabled={safeCurrent === 1}
        onClick={() => onPageChange(safeCurrent - 1)}
        className={btnBase}
      >
        이전
      </button>
      {pageNums.map((page) => (
        <button
          type="button"
          key={page}
          onClick={() => onPageChange(page)}
          className={`w-8 h-8 rounded-xl font-black text-xs transition-all ${
            safeCurrent === page
              ? 'bg-slate-800 text-white shadow-sm scale-105'
              : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'
          }`}
        >
          {page}
        </button>
      ))}
      <button
        type="button"
        disabled={safeCurrent === safeTotal}
        onClick={() => onPageChange(safeCurrent + 1)}
        className={btnBase}
      >
        다음
      </button>
      <button
        type="button"
        disabled={windowEnd >= safeTotal}
        onClick={() =>
          onPageChange(Math.min(safeTotal, windowStart + windowSize))
        }
        title={`다음 ${windowSize}페이지`}
        className={btnBase}
      >
        »
      </button>
      <span className="ml-1 text-[10px] font-bold text-slate-400 tabular-nums">
        {safeCurrent} / {safeTotal}
      </span>
    </div>
  );
}
