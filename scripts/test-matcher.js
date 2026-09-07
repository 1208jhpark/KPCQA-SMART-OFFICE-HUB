const fs = require('fs');
const { PDFParse } = require('pdf-parse');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function normalizeKo(value) {
  return String(value || '')
    .replace(/[\s\u00A0\u1680\u2000-\u200D\u2028\u2029\u202F\u205F\u3000\uFEFF]+/g, '')
    .replace(/[·ㆍ._\-()（）]/g, '')
    .toLowerCase();
}

function extractProjectsFromItemText(itemText) {
  const text = String(itemText || '').trim();
  const parenMatch = text.match(/[\(（]([\s\S]+?)[\)）]/);

  if (!parenMatch) {
    return { title: text.replace(/\s+/g, ' '), projects: [] };
  }

  const title = text.replace(/[\(（][\s\S]+?[\)）]/g, '').replace(/\s+/g, ' ').trim();
  const inside = parenMatch[1];
  const projects = inside
    .split(/[,，\n\r/]/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  return { title, projects };
}

async function run() {
  const buf = fs.readFileSync('public/uploads/production-statement/statement_SIGN_아트로릭_1788767547845.pdf');
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  const result = await parser.getText();
  const rawLines = result.text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const rowDataRegex = /([0-9]+\s*[*xX×]\s*[0-9]+)\s+(\d+)\s+[\\₩￦]?\s*([\d,]+)\s+[\\₩￦]?\s*([\d,]+)(?:\s+([가-힣\s]+))?/;

  const rows = [];
  let currentItemLines = [];
  let headerFound = false;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];

    // 헤더 행 감지
    if (!headerFound) {
      if (line.includes('품') && line.includes('목') && (line.includes('규격') || line.includes('수량'))) {
        headerFound = true;
      }
      continue;
    }

    if (line.includes('계 \t\\') || line.includes('합계') || line.includes('of 2')) continue;
    if (/^\d+월$/.test(line)) continue;

    const match = line.match(rowDataRegex);
    if (match) {
      const lineBeforeSpec = line.slice(0, match.index).trim();
      if (lineBeforeSpec) {
        currentItemLines.push(lineBeforeSpec);
      }

      const rawItem = currentItemLines.join(' ').replace(/\s+/g, ' ').trim();
      const spec = match[1].replace(/\s+/g, '');
      const qty = parseInt(match[2], 10);
      const unitPrice = parseInt(match[3].replace(/[^\d]/g, ''), 10);
      const supplyPrice = parseInt(match[4].replace(/[^\d]/g, ''), 10);
      const dept = (match[5] || '').trim();

      const { title, projects } = extractProjectsFromItemText(rawItem);
      const isJumul = title.includes('주물') || rawItem.includes('주물');

      rows.push({
        rawIndex: rows.length,
        rawItem,
        categoryTitle: title,
        isJumul,
        extractedProjects: projects,
        spec,
        qty,
        unitPrice,
        supplyPrice,
        dept
      });

      currentItemLines = [];
    } else {
      currentItemLines.push(line);
    }
  }

  console.log('=== Extracted Statement Rows ===');
  rows.forEach((r, idx) => {
    console.log(`[${idx}] ${r.categoryTitle} | Projects(${r.extractedProjects.length}): [${r.extractedProjects.join(', ')}] | Spec: ${r.spec} | Qty: ${r.qty} | Price: ${r.unitPrice}`);
  });

  // DB 아이템 조회
  const requests = await prisma.productionRequest.findMany({
    where: { batchId: { contains: '260831-008' } }
  });

  console.log('\n=== DB Items & Matching ===');
  for (const r of requests) {
    const opts = r.options || {};
    const projectName = String(opts.projectName || opts.isoCompanyName || r.title || '').trim();
    const certType = String(opts.certType || r.title || '').trim();
    const plateInfo = opts.plateMasterInfo || {};
    const plateLabel = String(plateInfo.label || opts.plateType || '').trim();
    const isJumul = plateLabel.includes('주물') || String(opts.plateType || '').includes('CAST_IRON');

    console.log(`\nDB Item: ${r.postNumber} | Proj: "${projectName}" | Cert: "${certType}" | Plate: "${plateLabel}" | Jumul: ${isJumul} | Qty: ${r.quantity}`);

    // 매칭 후보 찾기
    const candidates = rows.filter(row => {
      // 명함 제외
      if (row.categoryTitle.includes('명함')) return false;
      return row.extractedProjects.some(p => normalizeKo(p).includes(normalizeKo(projectName)) || normalizeKo(projectName).includes(normalizeKo(p)));
    });

    console.log(`  Found candidates (${candidates.length}):`);
    candidates.forEach(c => {
      console.log(`    -> Row ${c.rawIndex}: "${c.categoryTitle}" (${c.spec}, Qty: ${c.qty}, Unit: ₩${c.unitPrice.toLocaleString()}) | Dept: ${c.dept} | Jumul: ${c.isJumul}`);
    });
  }

  await parser.destroy();
  await prisma.$disconnect();
}

run().catch(console.error);
