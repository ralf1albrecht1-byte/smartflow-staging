import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { getCurrentVersion } from '../lib/legal-versions';

const prisma = new PrismaClient();

async function main() {
  // Seed admin user
  const hashedPassword = await bcrypt.hash('1234Test', 10);
  const adminUser = await prisma.user.upsert({
    where: { email: 'smiley.albi@web.de' },
    update: { password: hashedPassword, emailVerified: new Date() },
    create: { email: 'smiley.albi@web.de', name: 'Ralf Albrecht', password: hashedPassword, emailVerified: new Date(), acceptedTermsAt: new Date(), role: 'admin' },
  });

  // Seed test account (required for automated testing - no CompanySettings!)
  const testHashedPassword = await bcrypt.hash('johndoe123', 10);
  const testUser = await prisma.user.upsert({
    where: { email: 'john@doe.com' },
    update: { password: testHashedPassword, emailVerified: new Date() },
    create: { email: 'john@doe.com', name: 'Test User', password: testHashedPassword, emailVerified: new Date() },
  });

  // Block P — seed three ConsentRecord rows for both seeded users so they pass
  // the post-login compliance gate. Uses upsert-by-find to avoid duplicates on
  // re-seed (ConsentRecord has no natural unique key on (userId, documentType)).
  for (const u of [adminUser, testUser]) {
    for (const documentType of ['terms', 'privacy', 'avv'] as const) {
      const existing = await prisma.consentRecord.findFirst({
        where: { userId: u.id, documentType },
        select: { id: true },
      });
      if (!existing) {
        await prisma.consentRecord.create({
          data: {
            userId: u.id,
            documentType,
            documentVersion: getCurrentVersion(documentType),
            userAgent: 'system-seed',
          },
        });
      }
    }
  }

  // Seed services
  const services = [
    { name: 'Rasenm\u00e4hen', defaultPrice: 50, unit: 'Stunde' },
    { name: 'Heckenschneiden', defaultPrice: 7.5, unit: 'Meter' },
    { name: 'Baumschnitt', defaultPrice: 350, unit: 'Pauschal' },
    { name: 'Baumf\u00e4llung', defaultPrice: 800, unit: 'Pauschal' },
    { name: 'Gartengestaltung', defaultPrice: 55, unit: 'Stunde' },
    { name: 'Winterdienst / Schneeräumen', defaultPrice: 50, unit: 'Pauschal' },
    { name: 'Unkrautentfernung', defaultPrice: 48, unit: 'Stunde' },
    { name: 'Beetpflege', defaultPrice: 48, unit: 'Stunde' },
  ];

  for (const svc of services) {
    const existing = await prisma.service.findFirst({ where: { name: svc.name } });
    if (!existing) {
      await prisma.service.create({ data: svc });
    }
  }

  // Seed demo customers
  const customersData = [
    { name: 'Familie M\u00fcller', address: 'Bahnhofstrasse 15', plz: '5430', city: 'Wettingen', phone: '056 426 12 34', email: 'mueller@bluewin.ch' },
    { name: 'Hans Keller', address: 'Landstrasse 42', plz: '5400', city: 'Baden', phone: '056 222 56 78', email: 'h.keller@gmail.com' },
    { name: 'Gemeinde Wettingen', address: 'Alberich-Zwyssig-Str. 76', plz: '5430', city: 'Wettingen', phone: '056 437 71 11', email: 'info@wettingen.ch' },
  ];

  const createdCustomers: any[] = [];
  for (const cust of customersData) {
    const existing = await prisma.customer.findFirst({ where: { name: cust.name } });
    if (existing) {
      createdCustomers.push(existing);
    } else {
      const created = await prisma.customer.create({ data: cust });
      createdCustomers.push(created);
    }
  }

  // Seed demo orders
  if (createdCustomers.length >= 3) {
    const existingOrders = await prisma.order.count();
    if (existingOrders === 0) {
      await prisma.order.createMany({
        data: [
          { customerId: createdCustomers[0].id, description: 'Rasenm\u00e4hen Vorgarten', serviceName: 'Rasenm\u00e4hen', status: 'Erledigt', priceType: 'Stundensatz', unitPrice: 50, quantity: 2, totalPrice: 100, date: new Date('2026-03-15') },
          { customerId: createdCustomers[0].id, description: 'Heckenschnitt Garten', serviceName: 'Heckenschneiden', status: 'Offen', priceType: 'Stundensatz', unitPrice: 7.5, quantity: 20, totalPrice: 150, date: new Date('2026-04-10') },
          { customerId: createdCustomers[1].id, description: 'Baumschnitt Apfelbaum', serviceName: 'Baumschnitt', status: 'In Bearbeitung', priceType: 'Pauschal', unitPrice: 350, quantity: 1, totalPrice: 350, date: new Date('2026-04-05') },
          { customerId: createdCustomers[2].id, description: 'Beetpflege Rathausplatz', serviceName: 'Beetpflege', status: 'Offen', priceType: 'Stundensatz', unitPrice: 48, quantity: 4, totalPrice: 192, date: new Date('2026-04-12') },
        ],
      });
    }
  }

  // Seed counters
  await prisma.counter.upsert({ where: { name: 'invoice' }, create: { name: 'invoice', value: 0 }, update: {} });
  await prisma.counter.upsert({ where: { name: 'offer' }, create: { name: 'offer', value: 0 }, update: {} });

  console.log('Seed completed!');
}

main().catch(console.error).finally(() => prisma.$disconnect());