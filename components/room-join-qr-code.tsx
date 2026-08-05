'use client';

import QRCode from 'qrcode';
import { useEffect, useRef } from 'react';

import { normalizeGameCode } from '@/lib/game/lobby';

interface RoomJoinQrCodeProps {
  readonly code: string;
  readonly size?: number;
  readonly className?: string;
}

export function RoomJoinQrCode({
  code: rawCode,
  size = 320,
  className = '',
}: RoomJoinQrCodeProps) {
  const code = normalizeGameCode(rawCode);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const urlRef = useRef<HTMLAnchorElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const urlLink = urlRef.current;

    if (!canvas || !urlLink) {
      return;
    }

    const inviteUrl = `${window.location.origin}/join/${code}`;
    urlLink.href = inviteUrl;
    urlLink.textContent = inviteUrl;

    void QRCode.toCanvas(canvas, inviteUrl, {
      width: size,
      margin: 3,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#020617',
        light: '#ffffff',
      },
    }).catch(() => {
      canvas.hidden = true;
      if (errorRef.current) {
        errorRef.current.textContent =
          'QR non disponibile: usa il link riportato qui sotto.';
      }
    });
  }, [code, size]);

  return (
    <div className={`min-w-0 text-center ${className}`}>
      <div className='mx-auto w-fit max-w-full rounded-2xl bg-white p-2 shadow-sm'>
        <canvas
          aria-label={`QR code per entrare nella stanza ${code}`}
          className='block h-auto max-w-full'
          ref={canvasRef}
          role='img'
        />
      </div>
      <p className='mt-3 text-sm font-semibold' ref={errorRef} />
      <a
        className='mt-2 block break-all text-sm font-semibold underline decoration-2 underline-offset-4'
        href={`/join/${code}`}
        ref={urlRef}
      >
        /join/{code}
      </a>
    </div>
  );
}
