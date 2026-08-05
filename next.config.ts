import type { NextConfig } from 'next';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
let storageRemotePattern: URL | null = null;

if (supabaseUrl) {
  try {
    storageRemotePattern = new URL(
      '/storage/v1/object/public/quiz-media/**',
      supabaseUrl,
    );
  } catch {
    storageRemotePattern = null;
  }
}

const nextConfig: NextConfig = {
  images: {
    remotePatterns: storageRemotePattern ? [storageRemotePattern] : [],
  },
};

export default nextConfig;
