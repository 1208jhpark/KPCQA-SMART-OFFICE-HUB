/** (service) 레이아웃·홈 공통: F5/재진입 시 스플래시 없이 즉시 그리기용 세션 캐시 */

const SHELL_KEY = 'soh_service_shell_v1';
const HOME_CONFIG_KEY = 'soh_home_config_v1';

export type ServiceShellCache = {
  menus: any[];
  user: any;
  units: any[];
  savedAt: number;
};

export type HomeConfigCache = {
  config: any;
  menus: any[];
  savedAt: number;
};

const MAX_AGE_MS = 30 * 60 * 1000; // 30분

function readJson<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode */
  }
}

export function readServiceShellCache(): ServiceShellCache | null {
  const data = readJson<ServiceShellCache>(SHELL_KEY);
  if (!data?.user || !Array.isArray(data.menus)) return null;
  if (Date.now() - (data.savedAt || 0) > MAX_AGE_MS) return null;
  return data;
}

export function writeServiceShellCache(payload: Omit<ServiceShellCache, 'savedAt'>) {
  writeJson(SHELL_KEY, { ...payload, savedAt: Date.now() });
}

export function readHomeConfigCache(): HomeConfigCache | null {
  const data = readJson<HomeConfigCache>(HOME_CONFIG_KEY);
  if (!data?.config || !Array.isArray(data.menus)) return null;
  if (Date.now() - (data.savedAt || 0) > MAX_AGE_MS) return null;
  return data;
}

export function writeHomeConfigCache(payload: Omit<HomeConfigCache, 'savedAt'>) {
  writeJson(HOME_CONFIG_KEY, { ...payload, savedAt: Date.now() });
}
