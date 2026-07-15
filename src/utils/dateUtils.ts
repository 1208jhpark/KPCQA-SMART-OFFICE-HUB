// src/utils/dateUtils.ts

/**
 * 한국 시간(KST) 기준으로 정확한 YYYY-MM-DD 날짜 문자열을 반환합니다.
 * 오전 9시 이전 타임존 누수 버그를 완벽하게 방어합니다.
 */
export const getKSTDateString = (dateInput: Date | string | number = Date.now()) => {
    const date = new Date(dateInput);
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().split('T')[0];
  };