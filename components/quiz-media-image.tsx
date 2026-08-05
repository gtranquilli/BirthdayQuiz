'use client';

import Image from 'next/image';
import { useState } from 'react';

import type { QuizMedia } from '@/lib/game/media';
import { getQuizMediaPublicUrl } from '@/lib/game/media';

interface QuizMediaImageProps {
  readonly media: QuizMedia;
  readonly priority?: boolean;
  readonly sizes: string;
  readonly className?: string;
  readonly imageClassName?: string;
}

export function QuizMediaImage({
  media,
  priority = false,
  sizes,
  className = '',
  imageClassName = '',
}: QuizMediaImageProps) {
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const imageUrl = getQuizMediaPublicUrl(media.storagePath);

  if (!imageUrl || failedUrl === imageUrl) {
    return (
      <div
        className={`grid min-h-28 place-items-center rounded-2xl bg-slate-800/80 p-4 text-center text-sm font-semibold text-slate-300 ring-1 ring-white/10 ${className}`}
        role='img'
        aria-label={media.altText}
      >
        <span>
          Immagine non disponibile
          <span className='mt-1 block font-normal text-slate-400'>
            {media.altText}
          </span>
        </span>
      </div>
    );
  }

  return (
    <div
      className={`relative w-full overflow-hidden rounded-2xl bg-slate-900/70 ring-1 ring-white/10 ${className}`}
      style={{ aspectRatio: `${media.width} / ${media.height}` }}
    >
      {loadedUrl !== imageUrl ? (
        <div
          aria-hidden='true'
          className='absolute inset-0 animate-pulse bg-slate-800'
        />
      ) : null}
      <Image
        fill
        alt={media.altText}
        className={`object-contain ${imageClassName}`}
        priority={priority}
        sizes={sizes}
        src={imageUrl}
        onLoad={() => setLoadedUrl(imageUrl)}
        onError={() => setFailedUrl(imageUrl)}
      />
    </div>
  );
}
