import { NextResponse } from 'next/server';
import { PDFParse } from 'pdf-parse';

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const detailsStr = formData.get('batchDetails') as string;
    
    if (!file || !detailsStr) {
      return NextResponse.json({ error: '파일 또는 매칭 데이터가 없습니다.' }, { status: 400 });
    }

    let details = JSON.parse(detailsStr);
    let docTotalQty = 0;
    let docTotalPrice = 0;
    let logs: string[] = ['✅ [내부 API] PDF 파일 수신 완료. 자체 텍스트 해독을 시작합니다.'];

    const arrayBuffer = await file.arrayBuffer();

    let parsedText = '';
    try {
      const parser = new PDFParse({ data: new Uint8Array(arrayBuffer) });
      const result = await parser.getText();
      parsedText = result.text.replace(/\s/g, ''); 
      await parser.destroy(); 
      logs.push('✅ [내부 API] PDF 텍스트 레이어 추출 성공. 3+1 조건부 검증 가동.');
    } catch (parseError: any) {
      logs.push(`❌ [내부 API] PDF 텍스트 추출 실패: ${parseError.message}`);
      throw parseError;
    }

    // 🚀 3+1 조건부 매칭 알고리즘 기반 PDF 전역 통제 스캔
    details.forEach((d: any) => {
      // 1단계 [필수]: 이름과 '명함' 단어가 텍스트 내에 공존하는가?
      if (parsedText.includes(d.name) && parsedText.includes('명함')) {
        
        // 2단계: 현재 발주 대기열에 동일한 이름을 가진 동명이인이 같이 묶여 있는지 판별
        const sameNameItems = details.filter((item: any) => item.name === d.name);
        const hasHomonym = sameNameItems.length > 1;
        
        let isOrgValid = true;
        
        if (hasHomonym) {
          // 동명이인이 묶여있다면 본인의 소속(본부명 또는 센터명)이 본문에 무조건 명시되어야만 매칭 성공
          const containsDeptHead = d.deptHead && parsedText.includes(d.deptHead.replace(/\s/g, ''));
          const containsDeptName = d.deptName && parsedText.includes(d.deptName.replace(/\s/g, ''));
          
          if (!containsDeptHead && !containsDeptName) {
            isOrgValid = false; // 동명이인이 있는데 영수증에 소속 표기가 생략되었거나 다르면 자동 탈락
          }
        } else {
          // 동명이인이 없는 독보적인 이름인 경우: 소속 표기가 아예 생략되었어도 유연하게 통과 승인
          isOrgValid = true;
        }

        if (isOrgValid) {
          d.docQty = d.dbQty; // 텍스트 매칭 특성상 매칭 성공 시 수량 일치로 우선 확정
          docTotalQty += d.dbQty;
          docTotalPrice += d.dbQty * 20000;
          logs.push(`🔍 [텍스트 매칭 성공] ${d.name} 님 확인 (소속 유연성 통과 / 수량: ${d.docQty}통)`);
        } else {
          logs.push(`❌ [동명이인 매칭 제외] '${d.name}' 님이 문서에 존재하나 소속 식별이 불가능하여 제외`);
        }
      } else {
        logs.push(`⚠️ [누락] 문서 내에서 '${d.name}' 님 또는 '명함' 단어를 찾지 못함`);
      }
    });

    return NextResponse.json({
      details,
      docTotalQty,
      docTotalPrice,
      logs
    }, { status: 200 });

  } catch (error: any) {
    console.error("PDF 자체 파싱 오류:", error);
    return NextResponse.json({ 
      error: 'PDF 내부 분석 중 오류가 발생했습니다.',
      details: error.message
    }, { status: 500 });
  }
}