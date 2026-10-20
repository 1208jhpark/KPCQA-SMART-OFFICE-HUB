'use client';

import React from 'react';
import LocalQrImage from '@/components/common/LocalQrImage';
import { getItAssetVerifyUrl } from '@/utils/equipmentQr';

type Props = {
  /** IT·업무자산 자산번호 (code) */
  assetCode: string;
  size?: number;
  className?: string;
  alt?: string;
};

/** IT·업무자산 QR — `/m/verify?id=` 공개 조회로 연결 */
export default function ItAssetQrImage({
  assetCode,
  size = 250,
  className = '',
  alt = 'IT·업무자산 QR',
}: Props) {
  return (
    <LocalQrImage
      payload={getItAssetVerifyUrl(assetCode)}
      size={size}
      className={className}
      alt={alt}
    />
  );
}
