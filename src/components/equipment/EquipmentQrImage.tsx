'use client';

import React from 'react';
import LocalQrImage from '@/components/common/LocalQrImage';
import { getEquipmentVerifyUrl } from '@/utils/equipmentQr';

type Props = {
  equipmentId: string;
  size?: number;
  className?: string;
  alt?: string;
};

export default function EquipmentQrImage({
  equipmentId,
  size = 250,
  className = '',
  alt = 'QR',
}: Props) {
  return (
    <LocalQrImage
      payload={getEquipmentVerifyUrl(equipmentId)}
      size={size}
      className={className}
      alt={alt}
    />
  );
}
