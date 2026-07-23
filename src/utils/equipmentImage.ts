/**
 * 장비 사진: 상세용(data) + 목록용(thumb) dataURL 생성
 * - full: 긴 변 최대 1280px, JPEG ~0.82
 * - thumb: 긴 변 최대 160px, JPEG ~0.7  (목록 표출용, 용량 축소)
 */
export async function buildEquipmentImagePayload(file: File): Promise<string> {
  const rawDataUrl = await readFileAsDataUrl(file);
  const img = await loadImage(rawDataUrl);
  const data = canvasToJpegDataUrl(img, 1280, 0.82);
  const thumb = canvasToJpegDataUrl(img, 160, 0.7);
  return JSON.stringify({
    name: file.name,
    data,
    thumb,
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('파일 읽기 실패'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('이미지 로드 실패'));
    img.src = src;
  });
}

function canvasToJpegDataUrl(img: HTMLImageElement, maxEdge: number, quality: number) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) return '';

  const scale = Math.min(1, maxEdge / Math.max(w, h));
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(img, 0, 0, tw, th);
  return canvas.toDataURL('image/jpeg', quality);
}
