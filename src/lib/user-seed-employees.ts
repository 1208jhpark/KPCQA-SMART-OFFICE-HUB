/**
 * 전사 배포용 직원 시드 (WISE_empList 기준)
 * - prisma/seed.ts 에서 import
 * - email_local → {local}@kpcqa.or.kr
 */
import employees from './user-seed-employees.json';

export type SeedEmployee = {
  sort_order: number;
  email_local: string;
  name: string;
  name_en: string;
  employee_no: string;
  roles: string;
  unit_name: string;
  status: string;
  duty: string;
  duty_en: string;
  grade: string;
  grade_en: string;
};

export const SEED_EMPLOYEES: SeedEmployee[] = employees as SeedEmployee[];
