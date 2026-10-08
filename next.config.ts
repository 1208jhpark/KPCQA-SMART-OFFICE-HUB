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
};

export default nextConfig;
