export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { requireUserId, unauthorizedResponse } from '@/lib/get-session';

export async function POST(request: Request) {
  try {
    try { await requireUserId(); } catch { return unauthorizedResponse(); }
    const { html_content } = await request.json();
    const createResponse = await fetch('https://apps.abacus.ai/api/createConvertHtmlToPdfRequest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deployment_token: process.env.ABACUSAI_API_KEY,
        html_content,
        pdf_options: { format: 'A4', margin: { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' }, print_background: true },
        base_url: process.env.NEXTAUTH_URL || '',
      }),
    });
    if (!createResponse.ok) {
      return NextResponse.json({ success: false, error: 'PDF-Erstellung fehlgeschlagen' }, { status: 500 });
    }
    const { request_id } = await createResponse.json();
    if (!request_id) return NextResponse.json({ success: false, error: 'Keine Request-ID' }, { status: 500 });

    let attempts = 0;
    while (attempts < 120) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const statusResponse = await fetch('https://apps.abacus.ai/api/getConvertHtmlToPdfStatus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id, deployment_token: process.env.ABACUSAI_API_KEY }),
      });
      const statusResult = await statusResponse.json();
      const status = statusResult?.status || 'FAILED';
      if (status === 'SUCCESS') {
        const pdfData = statusResult?.result?.result;
        if (pdfData) {
          const pdfBuffer = Buffer.from(pdfData, 'base64');
          return new NextResponse(pdfBuffer, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="dokument.pdf"', 'Cache-Control': 'no-store, no-cache, must-revalidate, private, max-age=0', 'Pragma': 'no-cache', 'Expires': '0', 'Vary': 'Cookie', 'CDN-Cache-Control': 'no-store', 'Surrogate-Control': 'no-store' } });
        }
        return NextResponse.json({ success: false, error: 'Kein PDF-Ergebnis' }, { status: 500 });
      }
      if (status === 'FAILED') {
        return NextResponse.json({ success: false, error: 'PDF-Generierung fehlgeschlagen' }, { status: 500 });
      }
      attempts++;
    }
    return NextResponse.json({ success: false, error: 'Zeitüberschreitung' }, { status: 500 });
  } catch (error: any) {
    console.error('PDF error:', error);
    return NextResponse.json({ success: false, error: 'Fehler' }, { status: 500 });
  }
}
