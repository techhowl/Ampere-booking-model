import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { MODELS } from '../src/lib/catalog/catalog';
import { setUnits } from '../src/lib/inventory/inventory';

/**
 * Monthly stock maintenance, over a spreadsheet.
 *
 *   pnpm inventory:export                 -> inventory.csv
 *   pnpm inventory:import inventory.csv
 *
 * Ampere sets roughly 15 units per model per dealer each month, by hand. A CSV
 * is the right shape for that: it opens in Excel or Google Sheets, a regional
 * manager can edit it without an account on anything, and it diffs.
 *
 * Export writes a row for EVERY active dealer and model, including the ones
 * with no stock row yet, so the file is the full grid rather than only what
 * happens to exist. Nobody has to know which combinations are missing.
 *
 * Import goes through setUnits(), which takes the row lock and writes an audit
 * row — so a month's update is as traceable as any other change, and it cannot
 * corrupt a hold belonging to a checkout that is in flight. `units_reserved` is
 * never touched by either direction.
 */

const prisma = new PrismaClient();

const HEADER = 'dealer_code,dealer_name,model_code,model_name,units_total,units_reserved,available';

/** Minimal CSV quoting — dealer names contain commas often enough to matter. */
function cell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Splits one CSV line, honouring quotes. */
function parseLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      out.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out.map((f) => f.trim());
}

async function exportCsv(path: string) {
  const dealers = await prisma.dealer.findMany({
    where: { active: true },
    orderBy: { dealerCode: 'asc' },
  });

  if (dealers.length === 0) {
    console.error('No active dealers. Seed or import the dealer master first.');
    process.exit(1);
  }

  const rows = await prisma.inventory.findMany();
  const byKey = new Map(rows.map((r) => [`${r.modelCode}|${r.dealerCode}`, r]));

  const lines = [HEADER];
  for (const dealer of dealers) {
    for (const model of [...MODELS].sort((a, b) => a.sort - b.sort)) {
      const row = byKey.get(`${model.code}|${dealer.dealerCode}`);
      const total = row?.unitsTotal ?? 0;
      const reserved = row?.unitsReserved ?? 0;
      lines.push(
        [
          dealer.dealerCode,
          dealer.name,
          model.code,
          model.name,
          total,
          reserved,
          Math.max(0, total - reserved),
        ]
          .map(cell)
          .join(','),
      );
    }
  }

  writeFileSync(path, lines.join('\n') + '\n', 'utf8');
  console.log(`Wrote ${lines.length - 1} rows to ${path}`);
  console.log('Edit units_total, then: pnpm inventory:import ' + path);
  console.log('units_reserved and available are read-only — they are ignored on import.');
}

async function importCsv(path: string, changedBy: string) {
  const text = readFileSync(path, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);

  if (lines.length < 2) {
    console.error('Nothing to import.');
    process.exit(1);
  }

  const header = parseLine(lines[0] ?? '');
  const col = (name: string) => header.indexOf(name);
  const iDealer = col('dealer_code');
  const iModel = col('model_code');
  const iUnits = col('units_total');

  if (iDealer < 0 || iModel < 0 || iUnits < 0) {
    console.error('CSV must have dealer_code, model_code and units_total columns.');
    console.error(`Found: ${header.join(', ')}`);
    process.exit(1);
  }

  const knownModels = new Set(MODELS.map((m) => m.code));
  const knownDealers = new Set(
    (await prisma.dealer.findMany({ select: { dealerCode: true } })).map((d) => d.dealerCode),
  );

  /*
   * Validate the WHOLE file before writing anything. A half-applied stock
   * update is worse than a rejected one: you cannot tell by looking which
   * rows landed.
   */
  type Change = { modelCode: string; dealerCode: string; units: number; line: number };
  const changes: Change[] = [];
  const problems: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const fields = parseLine(lines[i] ?? '');
    const dealerCode = fields[iDealer] ?? '';
    const modelCode = fields[iModel] ?? '';
    const raw = fields[iUnits] ?? '';
    const lineNo = i + 1;

    if (!dealerCode && !modelCode) continue;

    if (!knownDealers.has(dealerCode)) {
      problems.push(`line ${lineNo}: unknown dealer_code "${dealerCode}"`);
      continue;
    }
    if (!knownModels.has(modelCode)) {
      problems.push(`line ${lineNo}: unknown model_code "${modelCode}"`);
      continue;
    }

    const units = Number(raw);
    if (!Number.isInteger(units) || units < 0) {
      problems.push(`line ${lineNo}: units_total "${raw}" must be a whole number, 0 or more`);
      continue;
    }

    changes.push({ modelCode, dealerCode, units, line: lineNo });
  }

  if (problems.length > 0) {
    console.error(`Refusing to import — ${problems.length} problem(s), nothing was written:\n`);
    for (const p of problems.slice(0, 40)) console.error('  ' + p);
    if (problems.length > 40) console.error(`  ... and ${problems.length - 40} more`);
    process.exit(1);
  }

  let changed = 0;
  for (const c of changes) {
    const before = await prisma.inventory.findUnique({
      where: { modelCode_dealerCode: { modelCode: c.modelCode, dealerCode: c.dealerCode } },
    });
    if (before?.unitsTotal === c.units) continue;

    await setUnits(prisma, {
      modelCode: c.modelCode,
      dealerCode: c.dealerCode,
      units: c.units,
      changedBy,
    });
    changed++;
  }

  console.log(`Checked ${changes.length} rows, updated ${changed}.`);
  if (changed === 0) console.log('Nothing differed from what is already stored.');
}

async function main() {
  const [mode, pathArg] = process.argv.slice(2);
  const path = pathArg ?? 'inventory.csv';

  if (mode === 'export') await exportCsv(path);
  else if (mode === 'import') {
    await importCsv(path, process.env.INVENTORY_CHANGED_BY ?? 'csv-import');
  } else {
    console.error('Usage: tsx scripts/inventory-csv.ts <export|import> [file]');
    process.exit(1);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
