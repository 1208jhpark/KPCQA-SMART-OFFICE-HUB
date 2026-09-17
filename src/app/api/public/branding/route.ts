import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

const FALLBACK = {
  main_headline: 'KPCQA WISE',
  sub_headline: 'KPCQA 통합업무지원시스템',
};

/**
 * [GET] 로그인 등 비로그인 화면용 공개 브랜딩
 * — main_headline / sub_headline 만 노출 (/admin/interface 설정과 동일 소스)
 */
export async function GET() {
  try {
    const config = await prisma.systemConfig.findUnique({
      where: { id: 'global' },
      select: { main_headline: true, sub_headline: true },
    });

    return NextResponse.json(
      {
        main_headline: String(config?.main_headline || '').trim() || FALLBACK.main_headline,
        sub_headline: String(config?.sub_headline || '').trim() || FALLBACK.sub_headline,
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error) {
    console.error('[public/branding GET]', error);
    return NextResponse.json(FALLBACK, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  }
}
