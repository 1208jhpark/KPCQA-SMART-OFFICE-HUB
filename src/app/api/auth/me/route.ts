import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';

import { JWT_SECRET } from '@/lib/jwt';
import { resolveDutyCode, resolveUserDutyOptions } from '@/lib/user-job-options';

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('token')?.value;

    if (!token) return NextResponse.json({ message: 'No Token' }, { status: 401 });

    const decoded: any = jwt.verify(token, JWT_SECRET);
    const userEmail = decoded.email;

    const user = await prisma.user.findFirst({
      where: { email: { equals: String(userEmail || ''), mode: 'insensitive' } },
      include: {
        unit: {
          include: {
            parent: true,
          },
        },
      },
    });

    if (!user) return NextResponse.json({ message: 'User Not Found' }, { status: 404 });

    const safeParseRoles = (roles: any) => {
      if (Array.isArray(roles)) return roles;
      if (typeof roles === 'string' && roles.trim() !== '') {
        try {
          return JSON.parse(roles);
        } catch {
          return [];
        }
      }
      return [];
    };

    let dutyOptions = resolveUserDutyOptions(undefined);
    try {
      const cfg = await prisma.systemConfig.findUnique({
        where: { id: 'global' },
        select: { user_duty_options: true },
      });
      dutyOptions = resolveUserDutyOptions(cfg?.user_duty_options);
    } catch {
      /* defaults */
    }

    const duty = user.duty || '';
    const duty_code = resolveDutyCode(duty, dutyOptions);

    return NextResponse.json({
      id: user.id,
      name: user.name,
      name_en: user.name_en || '',
      email: user.email,
      employee_no: user.employee_no || '',
      extension: user.extension || '',
      roles: safeParseRoles(user.roles),
      dept_id: user.unit_id,
      unit: user.unit,
      duty,
      duty_code,
      duty_en: user.duty_en || '',
      grade: user.grade || '',
      grade_en: user.grade_en || '',
      must_reset_password: !!user.must_reset_password,
    });
  } catch (error) {
    console.error('Auth Me Error:', error);
    return NextResponse.json({ message: 'Auth Error' }, { status: 500 });
  }
}
