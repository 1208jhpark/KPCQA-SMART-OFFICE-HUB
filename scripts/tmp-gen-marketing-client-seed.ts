/**
 * Excel Sheet1 → src/lib/marketing-client-seed.ts
 * 칼럼: 회사명, 부서, 업무범주, 기본(도로명)주소, 상세주소, 우편번호
 */
import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import {
  buildMarketingClientAddressData,
  normalizeMarketingDetail,
  normalizeMarketingRoad,
  normalizeMarketingZip,
} from '../src/lib/marketing-client-address';

const xlsxPath =
  'd:/@@@AX혁신센터_JH자료정리/★★★★★★Cursor AI_Smart office hub/@고객사관리/컨설팅사 정리.xlsx';

type SeedRow = {
  name: string;
  zip_code: string | null;
  address_road: string | null;
  address_detail: string | null;
  location: string | null;
  category: string;
  departments: { name: string; is_hidden: boolean }[];
};

function cleanDept(v: unknown): string {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ');
  return s || '전사';
}

const wb = XLSX.readFile(xlsxPath);
const sheetName = wb.SheetNames.includes('Sheet1') ? 'Sheet1' : wb.SheetNames[0];
const rows = XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets[sheetName], {
  defval: '',
  raw: false,
});

const seeds: SeedRow[] = [];
const seen = new Set<string>();
for (const r of rows) {
  const name = String(r['회사명'] || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!name) continue;
  const key = name.toLowerCase();
  if (seen.has(key)) continue;
  seen.add(key);

  const zip_code = normalizeMarketingZip(r['우편번호']);
  const address_road = normalizeMarketingRoad(r['기본(도로명)주소']);
  const address_detail = normalizeMarketingDetail(r['상세주소']);
  const built = buildMarketingClientAddressData({ zip_code, address_road, address_detail });

  seeds.push({
    name,
    zip_code: built.zip_code,
    address_road: built.address_road,
    address_detail: built.address_detail,
    location: built.location,
    category: String(r['업무범주'] || '').trim() || '건물 인증 관련',
    departments: [{ name: cleanDept(r['부서']), is_hidden: false }],
  });
}

const libPath = path.join(process.cwd(), 'src', 'lib', 'marketing-client-seed.ts');
const body = `/**
 * 마케팅 고객사 마스터 시드 — 컨설팅사 정리.xlsx (Sheet1)
 * - zip_code / address_road / address_detail / location(합본)
 * - 엑셀 행 순서 유지
 */
export type SeedMarketingClient = {
  name: string;
  zip_code: string | null;
  address_road: string | null;
  address_detail: string | null;
  location: string | null;
  category: string;
  departments: { name: string; is_hidden: boolean }[];
};

export const SEED_MARKETING_CLIENTS: readonly SeedMarketingClient[] = ${JSON.stringify(
  seeds,
  null,
  2
)} as const;
`;

fs.writeFileSync(libPath, body, 'utf8');
const withZip = seeds.filter((s) => s.zip_code).length;
console.log(
  JSON.stringify(
    {
      sheet: sheetName,
      count: seeds.length,
      withZip,
      first3: seeds.slice(0, 3).map((s) => ({
        name: s.name,
        zip: s.zip_code,
        road: s.address_road,
        detail: s.address_detail,
      })),
    },
    null,
    2
  )
);
