# 배포 PC용: DB에 테이블은 있지만 _prisma_migrations 이력이 없을 때 (P3005)
# 사용법 (프로젝트 루트에서, 서버 중지 후):
#   powershell -ExecutionPolicy Bypass -File scripts\baseline-deploy-migrations.ps1
#
# 동작:
# 1) page_view 제외한 기존 마이그레이션을 "이미 적용됨"으로 기록
# 2) migrate deploy 로 PageView 테이블만 실제 적용
# 3) prisma generate

$ErrorActionPreference = 'Continue'
Set-Location (Split-Path $PSScriptRoot -Parent)

$pageView = '20260930120000_page_view_stats'
$dirs = Get-ChildItem -Path 'prisma\migrations' -Directory | Sort-Object Name

Write-Host '=== 1) 기존 마이그레이션 베이스라인 (page_view 제외) ===' -ForegroundColor Cyan
foreach ($d in $dirs) {
  if ($d.Name -eq $pageView) { continue }
  Write-Host "resolve --applied $($d.Name)"
  npx prisma migrate resolve --applied $d.Name
  if ($LASTEXITCODE -ne 0) {
    Write-Host "  (경고) resolve 실패 — 이미 기록됐거나 건너뜀: $($d.Name)" -ForegroundColor Yellow
  }
}

Write-Host ''
Write-Host '=== 2) 남은 마이그레이션 적용 (PageView 등) ===' -ForegroundColor Cyan
npx prisma migrate deploy
if ($LASTEXITCODE -ne 0) {
  Write-Host ''
  Write-Host 'migrate deploy 실패 → PageView SQL을 직접 적용한 뒤 해당 마이그레이션을 applied 처리합니다.' -ForegroundColor Yellow
  npx prisma db execute --file "prisma\migrations\$pageView\migration.sql" --schema prisma\schema.prisma
  npx prisma migrate resolve --applied $pageView
  npx prisma migrate deploy
}

Write-Host ''
Write-Host '=== 3) prisma generate ===' -ForegroundColor Cyan
npx prisma generate

Write-Host ''
Write-Host '완료. 서버를 다시 기동하세요. (npm run start / 배포 스크립트)' -ForegroundColor Green
