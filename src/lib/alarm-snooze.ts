/** 홈 알람 스누즈(재알림) — 서버·클라이언트 공용 상수 (Node 전용 모듈 금지) */

/** Lifecycle 알람만 스누즈 가능 (즉시 처리성 업무는 제외) */
export const SNOOZABLE_ALARM_IDS = new Set([
  'it-replace-d30',
  'it-replace-overdue',
  'equip-calib',
]);

export const ALARM_SNOOZE_DAYS = 30;
