export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import puppeteer from 'puppeteer';
import { requireUserId, unauthorizedResponse } from '@/lib/get-session';

export async function POST(request: Request) {
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;

  try {
    try {
      await requireUserId();
    } catch {
      return unauthorizedResponse();
    }

    const { html_content } = await request.json();

    if (!html_content || typeof html_content !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Kein HTML-Inhalt vorhanden' },
        { status: 400 }
      );
    }

    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    const page = await browser.newPage();

    await page.setContent(html_content, {
      waitUntil: ['load', 'networkidle0'],
      timeout: 30000,
    });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '15mm',
        right: '15mm',
        bottom: '15mm',
        left: '15mm',
      },
    });

    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="dokument.pdf"',
        'Cache-Control': 'no-store, no-cache, must-revalidate, private, max-age=0',
        Pragma: 'no-cache',
        Expires: '0',
        Vary: 'Cookie',
        'CDN-Cache-Control': 'no-store',
        'Surrogate-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('PDF error:', error);

    return NextResponse.json(
      { success: false, error: 'PDF-Erstellung fehlgeschlagen' },
      { status: 500 }
    );
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}