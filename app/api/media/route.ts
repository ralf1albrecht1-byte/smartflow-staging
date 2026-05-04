import { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');

  if (!url) {
    return new Response('Missing URL', { status: 400 });
  }

  try {
    const res = await fetch(url);

    if (!res.ok) {
      return new Response('Failed to fetch image', { status: 500 });
    }

    const buffer = await res.arrayBuffer();

    return new Response(buffer, {
      headers: {
        'Content-Type': res.headers.get('content-type') || 'image/png',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch {
    return new Response('Error loading image', { status: 500 });
  }
}