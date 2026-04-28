export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { uploadBufferToS3, getFileUrl } from '@/lib/s3';
import { processIncomingMessage } from '@/lib/order-intake';
import { logAuditAsync } from '@/lib/audit';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

// POST: Incoming Telegram messages
export async function POST(request: Request) {
  try {
    const body = await request.json();
    console.log('Telegram webhook received:', JSON.stringify(body).slice(0, 500));

    const message = body?.message;
    if (!message) {
      return NextResponse.json({ ok: true });
    }

    const chatId = message.chat?.id;
    const from = message.from;
    const senderName = [from?.first_name, from?.last_name].filter(Boolean).join(' ') || 'Unbekannt';
    const senderPhone = message.contact?.phone_number || null;

    const hasPhoto = !!(message.photo && message.photo.length > 0);
    const hasVoice = !!message.voice;
    const hasAudio = !!message.audio;
    logAuditAsync({ action: 'TELEGRAM_MESSAGE_RECEIVED', area: 'WEBHOOK', details: { sender: senderName, chatId, hasText: !!message.text, hasMedia: hasPhoto || hasVoice || hasAudio } });

    let messageText = '';
    let imageBase64: string | null = null;
    let imageMimeType = 'image/jpeg';
    let savedMediaPath: string | null = null;
    let savedMediaType: 'audio' | 'image' | null = null;
    let optimizedPreviewPath: string | null = null;
    let optimizedThumbnailPath: string | null = null;

    // Text message
    if (message.text) {
      if (message.text.startsWith('/')) {
        if (message.text === '/start') {
          await sendTelegramMessage(chatId, 'Willkommen beim Business Manager! 📋\n\nSchicken Sie mir einfach eine Nachricht mit Ihrem Anliegen \u2013 Text, Sprachnachricht oder Foto. Ich erstelle automatisch einen Auftrag daraus.');
        }
        return NextResponse.json({ ok: true });
      }
      messageText = message.text;
    }
    // Voice message
    // ─── COST PROTECTION: Telegram audio transcription DISABLED (Item 4) ───
    // Telegram has no per-user quota tracking and the webhook is anonymously
    // reachable on the public internet. To prevent uncontrolled LLM-audio
    // calls, we DO NOT transcribe Telegram audio. The original media is
    // still archived to S3 so the user can play it back manually in the UI.
    else if (message.voice) {
      try {
        const audioData = await downloadTelegramFile(message.voice.file_id);
        if (audioData) {
          const ext = audioData.mimeType.includes('ogg') ? 'ogg' : 'mp3';
          savedMediaPath = await uploadBufferToS3(audioData.buffer, `telegram-voice-${Date.now()}.${ext}`, audioData.mimeType, false);
          savedMediaType = 'audio';
          console.log(`[Telegram] 🛑 Voice transcription DISABLED — saved to S3 only: ${savedMediaPath} (${(audioData.buffer.length / 1024).toFixed(0)}KB, ${audioData.mimeType})`);
          logAuditAsync({
            action: 'TELEGRAM_AUDIO_SKIPPED',
            area: 'WEBHOOK',
            success: true,
            details: {
              kind: 'voice',
              reason: 'transcription_disabled_for_telegram',
              fileBytes: audioData.buffer.length,
              mimeType: audioData.mimeType,
              chatId,
              sender: senderName,
            },
          });
        }
      } catch (err) {
        console.error('Telegram voice download error:', err);
      }
      messageText = 'Sprachnachricht empfangen (Transkription deaktiviert – bitte Audio in der App abspielen und Auftrag manuell erfassen).';
    }
    // Audio file
    else if (message.audio) {
      try {
        const audioData = await downloadTelegramFile(message.audio.file_id);
        if (audioData) {
          const ext = audioData.mimeType.includes('ogg') ? 'ogg' : audioData.mimeType.includes('mp4') ? 'm4a' : 'mp3';
          savedMediaPath = await uploadBufferToS3(audioData.buffer, `telegram-audio-${Date.now()}.${ext}`, audioData.mimeType, false);
          savedMediaType = 'audio';
          console.log(`[Telegram] 🛑 Audio transcription DISABLED — saved to S3 only: ${savedMediaPath} (${(audioData.buffer.length / 1024).toFixed(0)}KB, ${audioData.mimeType})`);
          logAuditAsync({
            action: 'TELEGRAM_AUDIO_SKIPPED',
            area: 'WEBHOOK',
            success: true,
            details: {
              kind: 'audio',
              reason: 'transcription_disabled_for_telegram',
              fileBytes: audioData.buffer.length,
              mimeType: audioData.mimeType,
              chatId,
              sender: senderName,
            },
          });
        }
      } catch (err) {
        console.error('Telegram audio download error:', err);
      }
      messageText = 'Audiodatei empfangen (Transkription deaktiviert – bitte Audio in der App abspielen und Auftrag manuell erfassen).';
    }
    // Photo
    else if (message.photo && message.photo.length > 0) {
      const photo = message.photo[message.photo.length - 1];
      const caption = message.caption || '';
      messageText = caption;
      try {
        const imageData = await downloadTelegramFile(photo.file_id);
        if (imageData) {
          imageMimeType = imageData.mimeType;

          // Save ORIGINAL image to S3 (archive)
          const ext = imageMimeType.includes('png') ? 'png' : imageMimeType.includes('webp') ? 'webp' : 'jpg';
          savedMediaPath = await uploadBufferToS3(imageData.buffer, `telegram-photo-${Date.now()}.${ext}`, imageMimeType, false);
          savedMediaType = 'image';
          console.log(`Telegram photo saved to S3 (original archive): ${savedMediaPath}`);

          // ─── COST OPTIMIZATION (Stage H) ───
          // Send WebP preview to AI, keep original in S3.
          let optimizedSentToAi = false;
          imageBase64 = imageData.buffer.toString('base64'); // fallback: original

          try {
            const { optimizeImage } = await import('@/lib/image-optimizer');
            const optimized = await optimizeImage(imageData.buffer, `telegram-photo-${Date.now()}`, imageMimeType);
            if (optimized) {
              optimizedPreviewPath = optimized.previewPath;
              optimizedThumbnailPath = optimized.thumbnailPath;
              imageBase64 = optimized.previewBuffer.toString('base64');
              imageMimeType = 'image/webp';
              optimizedSentToAi = true;
              console.log(
                `[Telegram] 🖼️ AI will receive optimized WebP preview ` +
                `(${(optimized.previewBytes / 1024).toFixed(0)}KB) instead of original ` +
                `(${(optimized.originalBytes / 1024).toFixed(0)}KB) — original kept in S3 archive.`
              );
            }
          } catch (optErr) {
            console.error('Telegram image optimization error (using original):', optErr);
          }
          if (!optimizedSentToAi) {
            console.warn(
              `[Telegram] ⚠️ Photo: optimization failed — falling back to ORIGINAL ` +
              `bytes for AI (${(imageData.buffer.length / 1024).toFixed(0)}KB).`
            );
          }
        }
      } catch (err) {
        console.error('Telegram image download error:', err);
      }
    }
    // Document (could be image)
    else if (message.document) {
      const mime = message.document.mime_type || '';
      if (mime.startsWith('image/')) {
        const caption = message.caption || '';
        messageText = caption;
        try {
          const imageData = await downloadTelegramFile(message.document.file_id);
          if (imageData) {
            imageMimeType = imageData.mimeType;

            const ext = imageMimeType.includes('png') ? 'png' : 'jpg';
            savedMediaPath = await uploadBufferToS3(imageData.buffer, `telegram-doc-${Date.now()}.${ext}`, imageMimeType, false);
            savedMediaType = 'image';

            // ─── COST OPTIMIZATION (Stage H) ───
            // Send WebP preview to AI, keep original in S3.
            let optimizedSentToAi = false;
            imageBase64 = imageData.buffer.toString('base64'); // fallback: original

            try {
              const { optimizeImage } = await import('@/lib/image-optimizer');
              const optimized = await optimizeImage(imageData.buffer, `telegram-doc-${Date.now()}`, imageMimeType);
              if (optimized) {
                optimizedPreviewPath = optimized.previewPath;
                optimizedThumbnailPath = optimized.thumbnailPath;
                imageBase64 = optimized.previewBuffer.toString('base64');
                imageMimeType = 'image/webp';
                optimizedSentToAi = true;
                console.log(
                  `[Telegram-Doc] 🖼️ AI will receive optimized WebP preview ` +
                  `(${(optimized.previewBytes / 1024).toFixed(0)}KB) instead of original ` +
                  `(${(optimized.originalBytes / 1024).toFixed(0)}KB) — original kept in S3 archive.`
                );
              }
            } catch (optErr) {
              console.error('Telegram doc image optimization error:', optErr);
            }
            if (!optimizedSentToAi) {
              console.warn(
                `[Telegram-Doc] ⚠️ optimization failed — falling back to ORIGINAL ` +
                `bytes for AI (${(imageData.buffer.length / 1024).toFixed(0)}KB).`
              );
            }
          }
        } catch (err) {
          console.error('Telegram document image error:', err);
        }
      } else {
        messageText = `[Dokument empfangen: ${message.document.file_name || 'unbekannt'}]`;
      }
    } else {
      messageText = '[Nachricht empfangen (nicht unterstützter Typ)]';
    }

    console.log(`Telegram from ${senderName} (Chat ${chatId}): ${messageText.slice(0, 100)}`);

    // Telegram: resolve userId — for now, use first account with CompanySettings
    // (Telegram doesn't provide a phone number we can match against)
    const { prisma } = await import('@/lib/prisma');
    const firstSettings = await prisma.companySettings.findFirst({
      where: { telefon: { not: null } },
      select: { userId: true },
      orderBy: { id: 'asc' },
    });
    const telegramUserId = firstSettings?.userId || null;

    const orderCreated = await processIncomingMessage({
      source: 'Telegram',
      senderName,
      messageText,
      imageBase64,
      imageMimeType,
      savedMediaPath,
      savedMediaType,
      optimizedPreviewPath,
      optimizedThumbnailPath,
      userId: telegramUserId,
    });

    if (orderCreated) {
      const customerLine = orderCreated.customerName && orderCreated.customerName !== 'Unbekannt'
        ? `\u{1F464} Kunde: ${orderCreated.customerName}\n`
        : `\u{1F464} Kunde: (nicht erkannt)\n`;
      const statusInfo = orderCreated.kundenabgleichStatus === 'gleicher_kunde'
        ? '(bestehender Kunde erkannt)'
        : orderCreated.kundenabgleichStatus === 'moeglicher_treffer'
        ? '(⚠️ möglicher Duplikat — bitte prüfen!)'
        : orderCreated.kundenabgleichStatus === 'konflikt'
        ? '(🚨 Konflikt — manuell prüfen!)'
        : '(neuer Kunde angelegt)';
      await sendTelegramMessage(chatId,
        `\u2705 Auftrag erstellt!\n\n` +
        `\u{1F4CB} ${orderCreated.description}\n` +
        customerLine +
        `\u{1F6E0} ${orderCreated.serviceName}\n` +
        `${statusInfo}\n\n` +
        `Vielen Dank!`
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('Telegram webhook error:', error);
    logAuditAsync({ action: 'TELEGRAM_WEBHOOK_ERROR', area: 'WEBHOOK', success: false, details: { error: error?.message || 'Unknown error' } });
    return NextResponse.json({ ok: true });
  }
}

async function sendTelegramMessage(chatId: number | string, text: string) {
  if (!BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
  } catch (err) {
    console.error('Failed to send Telegram message:', err);
  }
}

async function downloadTelegramFile(fileId: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  if (!BOT_TOKEN) return null;

  const fileRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
  if (!fileRes.ok) {
    console.error('Failed to get Telegram file info:', await fileRes.text());
    return null;
  }
  const fileInfo = await fileRes.json();
  const filePath = fileInfo?.result?.file_path;
  if (!filePath) return null;

  const downloadRes = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`);
  if (!downloadRes.ok) {
    console.error('Failed to download Telegram file:', await downloadRes.text());
    return null;
  }
  const arrayBuffer = await downloadRes.arrayBuffer();

  let mimeType = 'application/octet-stream';
  if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) mimeType = 'image/jpeg';
  else if (filePath.endsWith('.png')) mimeType = 'image/png';
  else if (filePath.endsWith('.ogg') || filePath.endsWith('.oga')) mimeType = 'audio/ogg';
  else if (filePath.endsWith('.mp3')) mimeType = 'audio/mpeg';
  else if (filePath.endsWith('.m4a')) mimeType = 'audio/mp4';
  else if (filePath.endsWith('.webp')) mimeType = 'image/webp';

  return { buffer: Buffer.from(arrayBuffer), mimeType };
}

// Convert OGG audio to MP3 using FFmpeg API (required because transcription API only accepts MP3/WAV)
async function convertOggToMp3ViaFfmpeg(oggUrl: string): Promise<Buffer | null> {
  try {
    console.log('FFmpeg: Starting OGG to MP3 conversion...');
    const createResponse = await fetch('https://apps.abacus.ai/api/createRunFfmpegCommandRequest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deployment_token: process.env.ABACUSAI_API_KEY,
        input_files: { in_1: oggUrl },
        output_files: { out_1: 'audio.mp3' },
        ffmpeg_command: '-i {{in_1}} -acodec libmp3lame -ar 16000 -ac 1 -b:a 64k {{out_1}}',
      }),
    });

    if (!createResponse.ok) {
      console.error('FFmpeg create error:', await createResponse.text());
      return null;
    }

    const { request_id } = await createResponse.json();
    if (!request_id) {
      console.error('FFmpeg: No request_id returned');
      return null;
    }

    // Poll for completion (max 90 seconds)
    for (let i = 0; i < 90; i++) {
      await new Promise(r => setTimeout(r, 1000));

      const statusRes = await fetch('https://apps.abacus.ai/api/getRunFfmpegCommandStatus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id, deployment_token: process.env.ABACUSAI_API_KEY }),
      });

      const statusResult = await statusRes.json();

      if (statusResult?.status === 'SUCCESS' && statusResult?.result?.result?.out_1) {
        const mp3Url = statusResult.result.result.out_1;
        console.log('FFmpeg: Conversion successful, downloading MP3...');
        const mp3Res = await fetch(mp3Url);
        if (mp3Res.ok) {
          const arrayBuffer = await mp3Res.arrayBuffer();
          console.log(`FFmpeg: MP3 downloaded, size: ${arrayBuffer.byteLength} bytes`);
          return Buffer.from(arrayBuffer);
        }
        console.error('FFmpeg: Failed to download converted MP3');
        return null;
      } else if (statusResult?.status === 'FAILED') {
        console.error('FFmpeg conversion failed:', statusResult?.result?.error || 'unknown error');
        return null;
      }
      // Still processing, continue polling
    }

    console.error('FFmpeg: Conversion timed out after 90s');
    return null;
  } catch (err) {
    console.error('FFmpeg conversion error:', err);
    return null;
  }
}

// Transcribe audio using LLM audio model (requires MP3 format)
async function transcribeAudio(mp3Buffer: Buffer): Promise<string | null> {
  const base64Audio = mp3Buffer.toString('base64');

  try {
    console.log('Transcription: Sending MP3 to audio model...');
    const response = await fetch('https://apps.abacus.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.ABACUSAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-audio-preview-2025-06-03',
        messages: [
          { role: 'system', content: 'Transkribiere die folgende Sprachnachricht auf Deutsch. Gib nur den transkribierten Text zurück, ohne Anführungszeichen oder Erklärungen. Auch Schweizerdeutsch/Dialekt soll auf Hochdeutsch transkribiert werden.' },
          { role: 'user', content: [{ type: 'input_audio', input_audio: { data: base64Audio, format: 'mp3' } }] },
        ],
        max_tokens: 2000,
      }),
    });
    if (!response.ok) {
      const errText = await response.text();
      console.error('Transcription API error:', errText);
      return null;
    }
    const result = await response.json();
    const text = result?.choices?.[0]?.message?.content ?? null;
    console.log(`Transcription result: ${text?.slice(0, 200) || 'null'}`);
    return text;
  } catch (err) {
    console.error('Transcription error:', err);
    return null;
  }
}


