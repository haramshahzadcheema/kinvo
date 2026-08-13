import { createContainer } from '../../src/core/container';
import { disconnectPrisma, prisma } from '../../src/core/prisma';
import { logger } from '../../src/core/logger';
import { DEMO_PASSWORD, PRIMARY_ORG_NAME, SECONDARY_ORG_NAME } from './data';
import { createRng } from './rng';
import { deleteDemoData, findExistingDemoOrgs } from './reset';
import { seedDemoData, type SeedReport } from './seed';

const DEMO_ORG_NAMES = [PRIMARY_ORG_NAME, SECONDARY_ORG_NAME];

function printReport(report: SeedReport): void {
  const lines: string[] = [];
  lines.push('');
  lines.push('==================== Kinvo Demo Seed — Data Quality Report ====================');
  lines.push('');
  lines.push('Seed Summary:');
  for (const [entity, count] of Object.entries(report.counts)) {
    lines.push(`  ${entity.padEnd(20)} ${count}`);
  }
  lines.push('');
  lines.push('Organizations:');
  for (const org of report.organizations) {
    lines.push(`  ${org.name}  (${org.id})`);
  }
  lines.push('');
  lines.push('Demo Accounts (all share one password — see below):');
  for (const account of report.demoAccounts) {
    lines.push(`  ${account.email.padEnd(34)} ${account.role.padEnd(11)} ${account.organizationName}`);
  }
  lines.push('');
  lines.push(`  Password for every seeded account: ${DEMO_PASSWORD}`);
  lines.push('  (Local/demo-only credential for the @kinvo-demo.test domain — never a real secret.)');
  lines.push('');
  lines.push('Verification:');
  lines.push('  Seed completed             PASS');
  lines.push('  (Run again to verify idempotency; run tests/typecheck/lint/build separately.)');
  lines.push('');
  lines.push('=================================================================================');
  lines.push('');
  // eslint-disable-next-line no-console
  console.log(lines.join('\n'));
}

async function main(): Promise<void> {
  const reset = process.argv.includes('--reset');
  const seedValue = process.env.SEED ?? 'kinvo-demo';
  const rng = createRng(seedValue);

  const existing = await findExistingDemoOrgs(prisma, DEMO_ORG_NAMES);

  if (existing.length > 0 && !reset) {
    // eslint-disable-next-line no-console
    console.log(
      `Demo data already exists (${existing.map((o) => o.name).join(', ')}). ` +
        'Nothing to do — run with --reset to rebuild it from scratch.',
    );
    return;
  }

  if (existing.length > 0 && reset) {
    logger.info({ orgs: existing.map((o) => o.name) }, 'Resetting existing demo data');
    await deleteDemoData(
      prisma,
      existing.map((o) => o.id),
    );
  }

  const container = createContainer();
  const report = await seedDemoData(prisma, container, rng);
  printReport(report);
}

// createContainer() wires a real ioredis connection (and, indirectly, a
// pino worker-thread transport for pretty-printing in dev) — neither is
// ever explicitly closed by this script, so without a forced exit the
// process lingers as a zombie after finishing instead of returning control
// to the terminal. This is a one-shot CLI script, not a long-lived server;
// exiting explicitly once the report is printed (or the error is logged)
// is the correct, standard shape for that — not a workaround for a bug in
// those connections.
main()
  .then(async () => {
    await disconnectPrisma();
    process.exit(0);
  })
  .catch(async (error) => {
    logger.error({ err: error }, 'Demo seed failed');
    await disconnectPrisma();
    process.exit(1);
  });
