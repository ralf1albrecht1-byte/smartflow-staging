export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureAddressSplit } from '@/lib/address-parser';
import { requireUserId, unauthorizedResponse } from '@/lib/get-session';
import { verifyCustomerMatch } from '@/lib/customer-matching';
import { sanitizeNewCustomerFields } from '@/lib/intake-sanitize';
import { findExactDeterministicMatch, findNearExactDeterministicMatch } from '@/lib/exact-customer-match';
import { logAuditAsync } from '@/lib/audit';

export async function POST(request: Request) {
  try {
    let userId: string;
    try { userId = await requireUserId(); } catch { return unauthorizedResponse(); }

    const data = await request.json();
    const message = data?.message ?? '';
    const action = data?.action ?? 'analyze';
    const imageBase64 = data?.imageBase64 ?? null;
    const imageMimeType = data?.imageMimeType ?? 'image/jpeg';
    const audioTranscript = data?.audioTranscript ?? null;

    if (!message.trim() && !imageBase64 && !audioTranscript && action === 'analyze') {
      return NextResponse.json({ error: 'Keine Nachricht angegeben' }, { status: 400 });
    }

    // ─── COST PROTECTION: 15 MB hard input cap on raw image (Item 1) ───
    // Reject very large image payloads BEFORE any LLM/Vision call.
    // base64 length × 0.75 ≈ raw bytes (~3% accuracy, conservative).
    if (imageBase64 && action === 'analyze') {
      const rawBytes = Math.floor(String(imageBase64).length * 0.75);
      const MAX_IMAGE_INPUT_BYTES = 15 * 1024 * 1024;
      if (rawBytes > MAX_IMAGE_INPUT_BYTES) {
        logAuditAsync({
          userId,
          action: 'QUICK_INTAKE_IMAGE_TOO_LARGE',
          area: 'API',
          success: false,
          details: {
            rawBytes,
            maxBytes: MAX_IMAGE_INPUT_BYTES,
            mimeType: imageMimeType,
          },
        });
        return NextResponse.json(
          {
            error: '⚠️ Bild zu groß (max. 15 MB). Bitte kleineres Bild verwenden.',
            blocked: true,
            reason: 'image_too_large',
            maxBytes: MAX_IMAGE_INPUT_BYTES,
          },
          { status: 413 },
        );
      }
    }

    // ─── COST PROTECTION: optimize image before Vision/LLM (Item 1) ───
    // Convert to in-memory WebP preview (max 1200px, Q75). Keep variable
    // names compatible — `imageBase64` flag still gates the gpt-4.1 model
    // selection downstream. On any failure: silent fallback to original.
    let aiImageBase64: string | null = imageBase64;
    let aiImageMimeType: string = imageMimeType;
    if (imageBase64 && action === 'analyze') {
      try {
        const buffer = Buffer.from(imageBase64, 'base64');
        const { optimizeImageBufferForAi } = await import('@/lib/image-optimizer');
        const opt = await optimizeImageBufferForAi(buffer, imageMimeType);
        if (opt) {
          aiImageBase64 = opt.previewBuffer.toString('base64');
          aiImageMimeType = opt.mimeType;
          logAuditAsync({
            userId,
            action: 'QUICK_INTAKE_IMAGE_AI_PAYLOAD',
            area: 'API',
            details: {
              optimized: true,
              originalBytes: opt.originalBytes,
              aiBytes: opt.previewBytes,
              mimeType: opt.mimeType,
            },
          });
        } else {
          logAuditAsync({
            userId,
            action: 'QUICK_INTAKE_IMAGE_AI_PAYLOAD',
            area: 'API',
            success: false,
            details: {
              optimized: false,
              originalBytes: buffer.length,
              fallback: true,
              mimeType: imageMimeType,
            },
          });
        }
      } catch (err: any) {
        console.error('[quick-intake] image optimization error, using original:', err?.message || err);
      }
    }

    // ===== ACTION: ANALYZE =====
    if (action === 'analyze') {
      const [services, customers, settings] = await Promise.all([
        prisma.service.findMany({ where: { userId } }),
        prisma.customer.findMany({ where: { deletedAt: null, userId } }),
        prisma.companySettings.findFirst({ where: { userId } }),
      ]);
      const branche = settings?.branche || 'Gartenbau';
      const firmenname = settings?.firmenname || 'Business Manager';
      const serviceList = services.map((s: any) => `- ${s.name} (${s.defaultPrice} CHF/${s.unit})`).join('\n');
      // Phase 2b: only expose {name, id} to the LLM (no phone/address/email).
      // Authoritative customer match is done server-side via verifyCustomerMatch.
      const customerList = customers.map((c: any) => `- Name: "${c.name}", ID: "${c.id}"`).join('\n');

      const systemPrompt = `Du bist ein Assistent für ein ${branche}-Unternehmen in der Schweiz (${firmenname}). Analysiere die folgende Eingabe des Kunden (Text, Sprachnachricht-Transkript und/oder Bild) und extrahiere die relevanten Informationen.

WICHTIG: Kombiniere ALLE Eingaben (Text, Audio-Transkript, Bild) logisch zu einer zusammenhängenden Analyse. Nicht getrennt auswerten!

Verfügbare Leistungen mit Preisen:
${serviceList}

Bekannte Kunden:
${customerList}

Extrahiere folgende Informationen:
1. customerName: Name des Kunden (falls erkennbar)
2. customerPhone: Telefonnummer (falls vorhanden), sonst null
3. customerStreet: NUR Strasse und Hausnummer (z.B. "Bahnhofstr. 15"), sonst null
4. customerPlz: NUR Postleitzahl (z.B. "5430"), sonst null
5. customerCity: NUR Ortsname (z.B. "Wettingen"), sonst null
6. customerEmail: E-Mail-Adresse (falls vorhanden), sonst null
7. serviceName: Welche Leistung wird gewünscht? Wähle aus den verfügbaren Leistungen die passendste. Passe die Begriffe an die Branche "${branche}" an.
8. description: Kurze Beschreibung des Auftrags (1-2 Sätze). Beschreibe klar was gemacht werden soll.
9. estimatedQuantity: Geschätzte Menge. Wenn nicht angegeben, schätze realistisch. Nur die Zahl.
10. unit: Einheit (Stunde, Meter, Stück, Pauschal)
11. specialNotes: Besondere Bedingungen, Zustandsbeschreibung (verschmutzt, beschädigt, unfertig), wichtige Hinweise. Falls nichts: leerer String.
12. hinweisLevel: Bewertung der Besonderheiten: "none" (keine), "info" (informativ), "important" (wichtig), "warning" (kritisch/dringend)
13. existingCustomerId: Falls Kunde sicher erkannt (Telefon, E-Mail ODER vollständige Adresse stimmen überein), die ID. Sonst null.
14. matchConfidence: "strong" wenn Telefon/E-Mail/vollständige Adresse übereinstimmen, "weak" wenn nur Name ähnlich, null wenn kein Treffer.

WICHTIG KUNDENABGLEICH:
- Setze existingCustomerId NUR wenn ein STARKES Signal vorhanden ist (gleiche Telefonnummer, gleiche E-Mail, oder gleiche Strasse+PLZ/Ort).
- Bei NUR Name-Ähnlichkeit → existingCustomerId = null, matchConfidence = "weak"
- Ein Teilname (z.B. nur Vorname "Albrecht" vs. "Albrecht Stowitsch") ist KEIN Treffer → existingCustomerId = null

WICHTIG: Adresse IMMER aufteilen in separate Felder! Beispiel: "Landstr. 5, 5430 Wettingen" → customerStreet: "Landstr. 5", customerPlz: "5430", customerCity: "Wettingen"

Respond with raw JSON only.
{
  "customerName": "Name oder null",
  "customerPhone": null,
  "customerStreet": null,
  "customerPlz": null,
  "customerCity": null,
  "customerEmail": null,
  "serviceName": "Passende Leistung",
  "description": "Kurzbeschreibung",
  "estimatedQuantity": 10,
  "unit": "Meter",
  "specialNotes": "Besonderheiten oder leer",
  "hinweisLevel": "none",
  "existingCustomerId": "ID oder null",
  "matchConfidence": "strong oder weak oder null"
}`;

      // Build messages: combine text + audio transcript + image in ONE call
      const userContent: any[] = [];
      const textParts: string[] = [];
      if (message.trim()) {
        textParts.push(`Kundennachricht:\n"${message}"`);
      }
      if (audioTranscript && audioTranscript.trim()) {
        textParts.push(`Sprachnachricht-Transkript:\n"${audioTranscript}"`);
      }
      if (textParts.length > 0) {
        userContent.push({ type: 'text', text: textParts.join('\n\n') });
      }
      if (aiImageBase64) {
        userContent.push({ type: 'text', text: 'Der Kunde hat auch dieses Bild geschickt. Analysiere es zusammen mit den anderen Eingaben:' });
        userContent.push({ type: 'image_url', image_url: { url: `data:${aiImageMimeType};base64,${aiImageBase64}` } });
      }

      const response = await fetch('https://apps.abacus.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.ABACUSAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: imageBase64 ? 'gpt-4.1' : 'gpt-4.1-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent.length === 1 && !imageBase64 ? userContent[0].text : userContent },
          ],
          response_format: { type: 'json_object' },
          max_tokens: 1000,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('LLM API error:', errorText);
        return NextResponse.json({ error: 'KI-Analyse fehlgeschlagen' }, { status: 500 });
      }

      const llmResult = await response.json();
      const content = llmResult?.choices?.[0]?.message?.content;

      if (!content) {
        return NextResponse.json({ error: 'Keine Antwort von der KI erhalten' }, { status: 500 });
      }

      let parsed: any;
      try {
        parsed = JSON.parse(content);
      } catch {
        console.error('Failed to parse LLM response:', content);
        return NextResponse.json({ error: 'KI-Antwort konnte nicht verarbeitet werden' }, { status: 500 });
      }

      const matchedService = services.find((s: any) =>
        s.name.toLowerCase() === (parsed.serviceName || '').toLowerCase()
      ) || services.find((s: any) =>
        (parsed.serviceName || '').toLowerCase().includes(s.name.toLowerCase())
      );

      const unitPrice = matchedService ? Number(matchedService.defaultPrice) : 50;
      const unit = parsed.unit || matchedService?.unit || 'Stunde';
      const quantity = Number(parsed.estimatedQuantity) || 1;

      // ═══ SERVER-SIDE MATCH VERIFICATION (hardened v2) ═══
      // Even though the LLM may suggest existingCustomerId, we verify server-side.
      // Only phone/email matches allow auto-assignment.
      let matchVerdict: string = 'kein_treffer';
      let matchReason: string = '';
      let verifiedCustomerId: string | null = null;

      if (parsed.existingCustomerId) {
        const addr = ensureAddressSplit({
          customerStreet: parsed.customerStreet,
          customerPlz: parsed.customerPlz,
          customerCity: parsed.customerCity,
        });
        const matchResult = await verifyCustomerMatch(parsed.existingCustomerId, {
          phone: parsed.customerPhone,
          email: parsed.customerEmail,
          street: addr.street,
          plz: addr.plz,
          city: addr.city,
          name: parsed.customerName,
        });
        matchVerdict = matchResult.verdict;
        matchReason = matchResult.reason;
        // Only auto-assign for strong unique signals
        if (matchResult.verdict === 'auto_assign') {
          verifiedCustomerId = parsed.existingCustomerId;
        }
        // For bestaetigungs_treffer and moeglicher_treffer, do NOT set verifiedCustomerId
        // — the frontend must show a confirmation step
        console.log(`[quick-intake] Match verification: verdict=${matchResult.verdict}, reason=${matchResult.reason}, candidateId=${parsed.existingCustomerId}`);
      }

      return NextResponse.json({
        success: true,
        analysis: {
          ...parsed,
          // Override LLM's existingCustomerId with verified result
          existingCustomerId: verifiedCustomerId,
          // Provide match info for frontend confirmation UI
          matchVerdict,
          matchReason,
          suggestedCustomerId: matchVerdict !== 'kein_treffer' ? parsed.existingCustomerId : null,
          unitPrice,
          unit,
          estimatedQuantity: quantity,
          totalEstimate: unitPrice * quantity,
        },
      });
    }

    // ===== ACTION: CREATE ORDER =====
    if (action === 'create') {
      const analysis = data?.analysis;
      if (!analysis) {
        return NextResponse.json({ error: 'Keine Analysedaten' }, { status: 400 });
      }

      const addr = ensureAddressSplit({
        customerStreet: analysis.customerStreet,
        customerPlz: analysis.customerPlz,
        customerCity: analysis.customerCity,
        customerAddress: analysis.customerAddress,
      });

      // ═══ SERVER-SIDE VERIFICATION ON CREATE (hardened v2) ═══
      // Even if the frontend sends existingCustomerId, we re-verify server-side.
      // Only phone/email matches allow auto-assignment without explicit user confirmation.
      let customerId = analysis.existingCustomerId;
      const userConfirmedMatch = !!data?.userConfirmedMatch; // Frontend sends this when user explicitly confirmed

      if (customerId) {
        const existing = await prisma.customer.findFirst({ where: { id: customerId, userId, deletedAt: null } });
        if (!existing) {
          // Customer not found OR archived → don't auto-assign
          customerId = null;
        } else if (!userConfirmedMatch) {
          // User did NOT explicitly confirm → re-verify with strong signal check
          const verifyAddr = ensureAddressSplit({
            customerStreet: analysis.customerStreet,
            customerPlz: analysis.customerPlz,
            customerCity: analysis.customerCity,
            customerAddress: analysis.customerAddress,
          });
          const matchResult = await verifyCustomerMatch(customerId, {
            phone: analysis.customerPhone,
            email: analysis.customerEmail,
            street: verifyAddr.street,
            plz: verifyAddr.plz,
            city: verifyAddr.city,
            name: analysis.customerName,
          });
          if (matchResult.verdict !== 'auto_assign') {
            // Not a strong signal match and user didn't confirm → reject auto-assignment
            console.log(`[quick-intake] CREATE: Rejecting auto-assignment (verdict=${matchResult.verdict}, reason=${matchResult.reason}) — user did not confirm`);
            customerId = null;
          } else {
            console.log(`[quick-intake] CREATE: Auto-assignment verified (${matchResult.reason})`);
          }
        } else {
          console.log(`[quick-intake] CREATE: User explicitly confirmed match for ${customerId}`);
        }
      }

      // ═══ PHASE 2c: EXACT DETERMINISTIC REUSE (before creating a new customer) ═══
      // If no strong-signal auto-assign happened, and the incoming record is
      // fully addressed (name + street + plz + city), and exactly one active
      // candidate under this user matches strictly without phone/email
      // conflict → reuse that candidate instead of creating a duplicate.
      //
      // Phase 2d: accumulate auto-reuse tags for reviewReasons to surface in
      // the UI banner (informational; does NOT set needsReview).
      const autoReuseTags: string[] = [];
      if (!customerId) {
        const exact = await findExactDeterministicMatch(prisma, userId, {
          name: analysis.customerName || null,
          street: addr.street,
          plz: addr.plz,
          city: addr.city,
          phone: analysis.customerPhone || null,
          email: analysis.customerEmail || null,
        });
        if (exact.match) {
          customerId = exact.match.id;
          autoReuseTags.push(`AUTO_REUSED:${exact.match.customerNumber}`);
          console.log(`[quick-intake] 🎯 EXACT REUSE → binding to existing ${exact.match.customerNumber} (${exact.match.id})`);
          logAuditAsync({
            userId, action: 'CUSTOMER_REUSE_EXACT', area: 'CUSTOMERS',
            targetType: 'Customer', targetId: exact.match.id,
            success: true,
            details: {
              source: 'quick-intake',
              matchedOn: ['name', 'street', 'plz', 'city'],
              candidateCustomerNumber: exact.match.customerNumber,
            },
          });
          // Improve-only update is handled by the existing `else` branch below
          // which runs protectCustomerData(existing, incoming) for any non-null
          // customerId.
        } else if (exact.reason !== 'incomplete_incoming' && exact.reason !== 'no_candidate') {
          console.log(`[quick-intake] exact-reuse skipped (${exact.reason}, count=${exact.candidateCount}) → normal create path`);
        }
      }

      // ═══ PHASE 2d: NEAR-EXACT DETERMINISTIC REUSE (strict) ═══
      // Triggers ONLY when: name+street exact, EXACTLY ONE of {plz, city}
      // missing on incoming, candidate has that field filled, exactly 1 active
      // candidate, no phone/email conflict. Completion is implicit (order
      // binds to candidate). See spec in lib/exact-customer-match.ts.
      if (!customerId) {
        const nearExact = await findNearExactDeterministicMatch(prisma, userId, {
          name: analysis.customerName || null,
          street: addr.street,
          plz: addr.plz,
          city: addr.city,
          phone: analysis.customerPhone || null,
          email: analysis.customerEmail || null,
        });
        if (nearExact.match && nearExact.completedField) {
          customerId = nearExact.match.id;
          autoReuseTags.push(`AUTO_REUSED_NEAR_EXACT:${nearExact.match.customerNumber}:${nearExact.completedField}_completed`);
          console.log(`[quick-intake] 🎯 NEAR-EXACT REUSE → binding to existing ${nearExact.match.customerNumber} (${nearExact.match.id}), completed=${nearExact.completedField}`);
          logAuditAsync({
            userId, action: 'CUSTOMER_REUSE_NEAR_EXACT', area: 'CUSTOMERS',
            targetType: 'Customer', targetId: nearExact.match.id,
            success: true,
            details: {
              source: 'quick-intake',
              matchedOn: ['name', 'street', nearExact.completedField === 'plz' ? 'city' : 'plz'],
              completedField: nearExact.completedField,
              completedValue: nearExact.completedValue,
              candidateCustomerNumber: nearExact.match.customerNumber,
            },
          });
        } else if (nearExact.reason !== 'not_applicable' && nearExact.reason !== 'incomplete_incoming' && nearExact.reason !== 'no_candidate') {
          console.log(`[quick-intake] near-exact-reuse skipped (${nearExact.reason}, count=${nearExact.candidateCount}) → normal create path`);
        }
      }

      if (!customerId) {
        // ═══ DEFENSE-IN-DEPTH: only persist master data fields that are
        // demonstrably present in the incoming raw text (message + audio
        // transcript). Prevents silent partial inheritance of LLM-hallucinated
        // or LLM-copied fields from the bestehende_kunden prompt list into a
        // newly created customer record.
        // Applies to CREATE only — improve-existing (auto_assign branch above)
        // goes through protectCustomerData and is unchanged.
        const rawCorpus = [
          data?.originalMessage ?? '',
          data?.audioTranscript ?? '',
          analysis.customerName ?? '',
        ].filter(Boolean).join('\n');
        const sanitized = sanitizeNewCustomerFields({
          rawText: rawCorpus,
          street: addr.street,
          plz: addr.plz,
          city: addr.city,
          phone: analysis.customerPhone,
          email: analysis.customerEmail,
        });
        if (sanitized.dropped.length > 0) {
          console.log(`[quick-intake] 🛡️ intake-sanitize dropped unverified fields on new-customer create: ${sanitized.dropped.join(', ')}`);
        }

        const name = analysis.customerName && analysis.customerName !== 'Unbekannt' ? analysis.customerName : 'Neuer Kunde';
        const { generateCustomerNumber } = await import('@/lib/customer-number');
        const customerNumber = await generateCustomerNumber();
        const customer = await prisma.customer.create({
          data: {
            customerNumber,
            name,
            phone: sanitized.phone,
            email: sanitized.email,
            address: sanitized.street,
            plz: sanitized.plz,
            city: sanitized.city,
            notes: 'Schnell-Eingang',
            userId,
          },
        });
        customerId = customer.id;
      } else {
        const cust = await prisma.customer.findUnique({ where: { id: customerId } });
        if (cust) {
          const { protectCustomerData } = await import('@/lib/data-protection');
          const updates = protectCustomerData(cust, {
            address: addr.street, plz: addr.plz, city: addr.city,
            email: analysis.customerEmail, phone: analysis.customerPhone,
          });
          if (Object.keys(updates).length > 0) {
            await prisma.customer.update({ where: { id: customerId }, data: updates });
          }
        }
      }

      const unitPrice = Number(analysis.unitPrice) || 50;
      const quantity = Number(analysis.estimatedQuantity) || 1;
      const totalPrice = unitPrice * quantity;

      const order = await prisma.order.create({
        data: {
          customerId,
          userId,
          description: analysis.description || 'Neuer Auftrag',
          serviceName: analysis.serviceName || 'Sonstiges',
          status: 'Offen',
          priceType: analysis.unit || 'Stunde',
          unitPrice,
          quantity,
          totalPrice,
          date: new Date(),
          notes: data.originalMessage ? `WhatsApp-Eingang:\n${data.originalMessage}` : null,
          specialNotes: analysis.specialNotes || null,
          needsReview: false, // Never set needsReview from specialNotes — review is determined by customer data quality and assignment confidence
          reviewReasons: autoReuseTags, // Phase 2d: surface auto-reuse info in UI banner (does NOT set needsReview)
          hinweisLevel: analysis.hinweisLevel || 'none',
          mediaUrl: data.mediaUrl || null,
          mediaType: data.mediaType || null,
          audioTranscript: data.audioTranscript || null,
          items: {
            create: [{
              serviceName: analysis.serviceName || 'Sonstiges',
              description: analysis.description || 'Neuer Auftrag',
              quantity,
              unit: analysis.unit || 'Stunde',
              unitPrice,
              totalPrice,
            }],
          },
        },
        include: { customer: true, items: true },
      });

      return NextResponse.json({
        success: true,
        order: {
          ...order,
          totalPrice: Number(order.totalPrice),
          unitPrice: Number(order.unitPrice),
          quantity: Number(order.quantity),
        },
      });
    }

    return NextResponse.json({ error: 'Ungültige Aktion' }, { status: 400 });
  } catch (error: any) {
    console.error('Quick intake error:', error);
    return NextResponse.json({ error: 'Fehler beim Verarbeiten der Nachricht' }, { status: 500 });
  }
}
