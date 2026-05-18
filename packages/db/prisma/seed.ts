import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Hash password: "password123"
  const passwordHash = crypto
    .createHash('sha256')
    .update('password123')
    .digest('hex');

  // Create demo users
  const ama = await prisma.user.upsert({
    where: { email: 'ama@example.com' },
    update: {},
    create: { email: 'ama@example.com', name: 'Ama Kusi', passwordHash },
  });

  const kofi = await prisma.user.upsert({
    where: { email: 'kofi@example.com' },
    update: {},
    create: { email: 'kofi@example.com', name: 'Kofi Mensah', passwordHash },
  });

  // Create demo project
  const project = await prisma.project.upsert({
    where: { slug: 'payments-api' },
    update: {},
    create: {
      name: 'Payments API',
      slug: 'payments-api',
      ownerId: ama.id,
    },
  });

  // Add Kofi as editor
  await prisma.projectMember.upsert({
    where: { projectId_userId: { projectId: project.id, userId: kofi.id } },
    update: {},
    create: { projectId: project.id, userId: kofi.id, role: 'editor' },
  });

  // Create suites
  const authSuite = await prisma.testSuite.create({
    data: { projectId: project.id, name: 'Auth' },
  });

  const paymentsSuite = await prisma.testSuite.create({
    data: { projectId: project.id, name: 'Payments' },
  });

  // Create sample test cases
  await prisma.testCase.createMany({
    data: [
      {
        projectId: project.id,
        suiteId: authSuite.id,
        title: 'Login with valid credentials',
        type: 'manual',
        priority: 'p0',
        version: 1,
        tags: JSON.stringify(['smoke', 'auth']),
        createdById: ama.id,
        steps: JSON.stringify([
          { order: 1, action: 'Navigate to /login', expected: 'Login form is visible' },
          { order: 2, action: 'Enter valid email and password', expected: 'Fields accept input' },
          { order: 3, action: 'Click Sign in button', expected: 'Redirected to dashboard' },
        ]),
      },
      {
        projectId: project.id,
        suiteId: paymentsSuite.id,
        title: 'POST /charge returns 201',
        type: 'api',
        priority: 'p0',
        version: 1,
        tags: JSON.stringify(['smoke', 'payments']),
        createdById: kofi.id,
        steps: JSON.stringify({
          method: 'POST',
          url: '/v1/charge',
          headers: { 'Content-Type': 'application/json' },
          body: { amount: 2000, currency: 'gbp', card_id: '{{test_card}}' },
          assertions: [
            { field: 'status', op: 'eq', expected: 201 },
            { field: 'body.charge_id', op: 'exists', expected: null },
          ],
          responseTimeThresholdMs: 500,
        }),
      },
      {
        projectId: project.id,
        suiteId: paymentsSuite.id,
        title: 'Explore checkout edge cases',
        type: 'exploratory',
        priority: 'p2',
        version: 1,
        tags: JSON.stringify(['exploratory', 'checkout']),
        createdById: ama.id,
        steps: JSON.stringify({
          charter: 'Explore the checkout flow focusing on coupon codes and out-of-stock items',
          durationMins: 60,
          area: 'Checkout',
          riskFocus: 'Functionality',
        }),
      },
    ],
  });

  console.log(`✓ Seeded project: ${project.name}`);
  console.log(`✓ Users: ${ama.email}, ${kofi.email}`);
  console.log(`✓ Suites: Auth, Payments`);
  console.log(`✓ Test cases: 3 created`);
  console.log('\nLogin with: ama@example.com / password123');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
