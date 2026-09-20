/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { PLAN_CATALOGUE } from '@uzanite/contracts';

const prisma = new PrismaClient();

// Reject weak/default bootstrap passwords so a copied `.env` cannot seed an
// admin account with a publicly-known credential.
function assertStrongBootstrapPassword(password: string): void {
  const weakDefaults = ['admin@12345!', 'change-me', 'changeme', 'password', 'admin123', 'letmein'];
  const errors: string[] = [];
  if (password.length < 12) errors.push('at least 12 characters');
  if (!/[A-Z]/.test(password)) errors.push('at least 1 uppercase letter');
  if (!/[a-z]/.test(password)) errors.push('at least 1 lowercase letter');
  if (!/[0-9]/.test(password)) errors.push('at least 1 number');
  if (!/[^A-Za-z0-9]/.test(password)) errors.push('at least 1 special character');
  const lower = password.toLowerCase();
  if (weakDefaults.some((w) => lower === w || lower.includes(w))) errors.push('must not be a known default');
  if (errors.length) {
    throw new Error(`BOOTSTRAP_ADMIN_PASSWORD is too weak: ${errors.join(', ')}`);
  }
}

// The plan catalogue lives in @uzanite/contracts so the seed, the entitlement
// guards and the DB can never disagree about which metrics and features exist.
const PLANS = PLAN_CATALOGUE;

async function main() {
  for (const plan of PLANS) {
    await prisma.plan.upsert({
      where: { key: plan.key },
      update: { name: plan.name, priceTzs: plan.priceTzs, limits: plan.limits, features: plan.features },
      create: {
        key: plan.key,
        name: plan.name,
        priceTzs: plan.priceTzs,
        limits: plan.limits,
        features: plan.features,
      },
    });
    console.log(`✅ plan ${plan.key}`);
  }

  const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if ((email && !password) || (!email && password)) {
    throw new Error('BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD must be set together');
  }
  if (email && password) {
    assertStrongBootstrapPassword(password);
    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.upsert({
      where: { email },
      update: { platformRole: 'super_admin', status: 'active' },
      create: {
        id: randomUUID(),
        email,
        name: 'Super Admin',
        passwordHash,
        platformRole: 'super_admin',
        status: 'active',
        mustChangePassword: true,
      },
    });
    console.log(`✅ bootstrap super admin ${email}`);
  } else {
    console.log('ℹ️  BOOTSTRAP_ADMIN_EMAIL/PASSWORD not set — skipping super admin seed');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
