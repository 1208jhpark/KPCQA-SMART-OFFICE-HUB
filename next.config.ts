import path from "path";
import { fileURLToPath } from "url";
import type { NextConfig } from "next";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  outputFileTracingRoot: projectRoot,
  serverExternalPackages: ['pdf-parse'],
  // 폰/다른 기기·배포 도메인에서 /_next 리소스 차단으로 암흑·로딩 멈춤 방지
  allowedDevOrigins: [
    '210.117.70.158',
    '127.0.0.1',
    'localhost',
    'qa.kpcqa.or.kr',
  ],
  async redirects() {
    return [
      { source: '/asset/it', destination: '/equipment/it/personal', permanent: false },
      { source: '/asset/it/personal', destination: '/equipment/it/personal', permanent: false },
      { source: '/asset/it/dept', destination: '/equipment/it/dept', permanent: false },
      { source: '/asset/it/master', destination: '/equipment/it/master/dashboard', permanent: false },
      {
        source: '/asset/it/master/:path*',
        destination: '/equipment/it/master/:path*',
        permanent: false,
      },
      { source: '/api/asset/it', destination: '/api/equipment/it', permanent: false },
      {
        source: '/api/asset/it/:path*',
        destination: '/api/equipment/it/:path*',
        permanent: false,
      },
      // 제작물 코너: /asset/production → /production/custom (알람·북마크 구주소)
      {
        source: '/asset/production/apply/history',
        destination: '/production/custom/my-orders/history',
        permanent: false,
      },
      {
        source: '/asset/production/apply/request',
        destination: '/production/custom/my-orders/request',
        permanent: false,
      },
      {
        source: '/asset/production/apply',
        destination: '/production/custom/my-orders',
        permanent: false,
      },
      {
        source: '/asset/production/dept-master/:path*',
        destination: '/production/custom/dept-master/:path*',
        permanent: false,
      },
      {
        source: '/asset/production/dept-master',
        destination: '/production/custom/dept-master',
        permanent: false,
      },
      {
        source: '/asset/production/master/:path*',
        destination: '/production/custom/admin/:path*',
        permanent: false,
      },
      {
        source: '/asset/production/master',
        destination: '/production/custom/admin',
        permanent: false,
      },
      {
        source: '/asset/production/client',
        destination: '/production/custom/clients',
        permanent: false,
      },
      {
        source: '/asset/production/clients',
        destination: '/production/custom/clients',
        permanent: false,
      },
      {
        source: '/api/asset/production/apply/history',
        destination: '/api/production/custom/my-orders/history',
        permanent: false,
      },
      {
        source: '/api/asset/production/apply/request',
        destination: '/api/production/custom/my-orders/request',
        permanent: false,
      },
      {
        source: '/api/asset/production/dept-master/:path*',
        destination: '/api/production/custom/dept-master/:path*',
        permanent: false,
      },
      {
        source: '/api/asset/production/master/:path*',
        destination: '/api/production/custom/admin/:path*',
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
