import * as XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';

const src =
  'd:/@@@AX혁신센터_JH자료정리/★Cursor AI_Smart office hub/전직원 아이디생성/WISE_empList_20260917.xls';
const dest = path.resolve('src/lib/user-seed-employees.json');

const wb = XLSX.readFile(src);
const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], {
  defval: '',
});

const out = rows.map((r, i) => {
  const empRaw = r.employee_no;
  const employee_no =
    empRaw === '' || empRaw == null
      ? ''
      : typeof empRaw === 'number'
        ? String(Math.trunc(empRaw))
        : String(empRaw).trim();
  return {
    sort_order: i + 1,
    email_local: String(r.email || '')
      .trim()
      .toLowerCase(),
    name: String(r.name || '').trim(),
    name_en: String(r.name_en || '').trim(),
    employee_no,
    roles: String(r.roles || 'LV_3').trim(),
    unit_name: String(r.unit_name || '').trim(),
    status: String(r.status || 'ACTIVE').trim(),
    duty: String(r.duty || '').trim(),
    duty_en: String(r.duty_en || '').trim(),
    grade: String(r.grade || '').trim(),
    grade_en: String(r.grade_en || '').trim(),
  };
});

fs.writeFileSync(dest, JSON.stringify(out, null, 2), 'utf8');
console.log('wrote', out.length, '→', dest);
