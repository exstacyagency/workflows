/* eslint-disable no-restricted-properties */
import bcrypt from 'bcryptjs';
import prisma from '../lib/prisma';
import { normalizeEmail } from '../lib/normalizeEmail';

function usage(): never {
  console.error('Usage: npm run dev:set-password -- <email> <newPassword>');
  process.exit(1);
}

async function main() {
  const email = normalizeEmail(process.argv[2]);
  const newPassword = process.argv[3];
  if (!email || !newPassword) usage();

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run set_password in production.');
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);

  const updated = await prisma.user.upsert({
    where: { email },
    update: { passwordHash },
    create: {
      email,
      passwordHash,
      // If your schema requires additional fields, add safe defaults here.
      // Example:
      // name: email.split("@")[0],
    },
    select: { id: true, email: true },
  });

  console.log('Password updated for:', updated.email);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
