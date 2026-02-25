import * as fs from "fs";
import * as path from "path";
import { parse } from "csv-parse/sync";
import {
  normalizePayee,
  categorize,
  applyPayeeOverrides,
  TransactionRow,
} from "./categorizer";
function loadExclusionRules(): { internal_transfer_types: string[]; internal_transfer_name_patterns: string[]; exclude_zero_amount: boolean } {
  const filePath = path.join(process.cwd(), "config", "exclusion_rules.json");
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

const DIRECT_DEBIT_TYPES = new Set([
  "Direct Debit",
  "Faster payment",
  "Bacs (Direct Credit)",
]);

interface RawCsvRow {
  "Transaction ID"?: string;
  Date?: string;
  Name?: string;
  Type?: string;
  Amount?: string;
  Category?: string;
  Notes?: string;
  [key: string]: string | undefined;
}

export interface ProcessedTransaction {
  id: string;
  date: Date;
  monthKey: string;
  day: number;
  name: string;
  payeeNormalized: string;
  type: string;
  amount: number;
  amountAbs: number;
  direction: string;
  monzoCategory: string;
  notes: string;
  accountLabel: string;
  sourceFile: string;
  categoryFinal: string;
  categoryGroup: string;
  isSpend: boolean;
  isInternalTransfer: boolean;
  isBillCandidate: boolean;
  billStatus: string;
  confidenceScore: number;
  confidenceReason: string;
  ruleIdApplied: string;
  requiredAmountExact: number;
  typicalDay: number | null;
}

function parseDateDDMMYYYY(dateStr: string): Date | null {
  const parts = dateStr.split("/");
  if (parts.length !== 3) return null;
  const [dd, mm, yyyy] = parts;
  const d = new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd));
  return isNaN(d.getTime()) ? null : d;
}

function loadSingleCsv(
  filePath: string,
  accountLabel: string
): { rows: RawCsvRow[]; fileName: string } {
  const content = fs.readFileSync(filePath, "utf-8");
  const rows = parse(content, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
  }) as RawCsvRow[];
  return { rows, fileName: path.basename(filePath) };
}

export function parseMonzoCsvs(
  csvPaths: string[]
): { rows: TransactionRow[]; rawCount: number } {
  const allRows: TransactionRow[] = [];

  const validPaths = csvPaths
    .map((p) => p.trim().replace(/\\/g, "/"))
    .filter((p) => {
      try {
        return fs.existsSync(p);
      } catch {
        return false;
      }
    });

  if (validPaths.length === 0) {
    throw new Error("No valid CSV files found");
  }

  for (let idx = 0; idx < validPaths.length; idx++) {
    const filePath = validPaths[idx].trim();
    const accountLabel = idx === 0 ? "Personal" : "Joint";
    const { rows, fileName } = loadSingleCsv(filePath, accountLabel);

    for (const raw of rows) {
      const dateStr = raw.Date || "";
      const date = parseDateDDMMYYYY(dateStr);
      if (!date) continue;

      const amount = parseFloat(raw.Amount || "0") || 0;
      const txId =
        raw["Transaction ID"] || `gen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      allRows.push({
        id: txId,
        name: raw.Name || "",
        monzoCategory: raw.Category || "",
        payeeNormalized: "",
        categoryFinal: "",
        categoryGroup: "",
        isBillRule: false,
        confidenceScore: 0,
        confidenceReason: "",
        ruleIdApplied: "",
        date,
        monthKey: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
        day: date.getDate(),
        type: raw.Type || "",
        amount,
        amountAbs: Math.abs(amount),
        direction: amount < 0 ? "outflow" : "inflow",
        notes: raw.Notes || "",
        accountLabel,
        sourceFile: fileName,
        isSpend: false,
        isInternalTransfer: false,
        isBillCandidate: false,
        billStatus: "not_bill",
        requiredAmountExact: 0,
        typicalDay: null,
      } as TransactionRow);
    }
  }

  return { rows: allRows, rawCount: allRows.length };
}

export function applyExclusions(rows: TransactionRow[]): TransactionRow[] {
  const exclusionRules = loadExclusionRules();
  const patterns = (
    exclusionRules.internal_transfer_name_patterns || []
  ).map((p) => p.toLowerCase());
  const transferTypes = new Set(
    exclusionRules.internal_transfer_types || []
  );
  const excludeZero = exclusionRules.exclude_zero_amount !== false;

  let result = rows;

  if (excludeZero) {
    result = result.filter((r) => (r.amount as number) !== 0);
  }

  for (const row of result) {
    let isInternal = false;

    if (transferTypes.has(row.type as string)) {
      isInternal = true;
    }

    if (!isInternal) {
      const nameLower = (row.name || "").toLowerCase();
      for (const pattern of patterns) {
        if (nameLower.includes(pattern)) {
          isInternal = true;
          break;
        }
      }
    }

    row.isInternalTransfer = isInternal;
    row.isSpend =
      (row.amount as number) < 0 && !isInternal;
  }

  return result;
}

export function applyBillStatus(rows: TransactionRow[]): TransactionRow[] {
  const spendRows = rows.filter((r) => r.isSpend);
  if (spendRows.length === 0) {
    for (const r of rows) {
      r.billStatus = "not_bill";
      r.isBillCandidate = false;
      r.requiredAmountExact = 0;
    }
    return rows;
  }

  // Find latest month
  const allMonths = [
    ...new Set(spendRows.map((r) => r.monthKey as string)),
  ].sort();
  const latestMonth = allMonths[allMonths.length - 1];

  // Recurring stats per payee
  const payeeStats = new Map<
    string,
    { monthsSeen: Set<string>; txCount: number }
  >();
  for (const row of spendRows) {
    const payee = row.payeeNormalized;
    if (!payeeStats.has(payee)) {
      payeeStats.set(payee, { monthsSeen: new Set(), txCount: 0 });
    }
    const stats = payeeStats.get(payee)!;
    stats.monthsSeen.add(row.monthKey as string);
    stats.txCount++;
  }

  // Mark bill candidates
  for (const row of rows) {
    const payee = row.payeeNormalized;
    const stats = payeeStats.get(payee) || {
      monthsSeen: new Set(),
      txCount: 0,
    };
    const recurringLike = stats.monthsSeen.size >= 2 && stats.txCount >= 2;
    const isCandidate =
      row.isBillRule ||
      (DIRECT_DEBIT_TYPES.has(row.type as string) && recurringLike);
    row.isBillCandidate = isCandidate;
  }

  // Latest month presence for candidates
  const candidateSpend = rows.filter(
    (r) => r.isBillCandidate && r.isSpend
  );
  const presentLatest = new Set(
    candidateSpend
      .filter((r) => r.monthKey === latestMonth)
      .map((r) => r.payeeNormalized)
  );
  const seenBefore = new Set(
    candidateSpend
      .filter((r) => r.monthKey !== latestMonth)
      .map((r) => r.payeeNormalized)
  );

  // Assign bill status
  for (const row of rows) {
    if (!row.isBillCandidate) {
      row.billStatus = "not_bill";
      continue;
    }

    const payee = row.payeeNormalized;
    let status = presentLatest.has(payee) ? "active" : "inactive_candidate";

    if (status === "inactive_candidate" && !seenBefore.has(payee)) {
      status = "not_bill";
    }

    row.billStatus = status;
  }

  // Calculate required amounts for active bills
  const activeSpend = rows.filter(
    (r) => r.billStatus === "active" && r.isSpend
  );

  // Latest month totals per payee
  const latestTotals = new Map<string, number>();
  const allTotals = new Map<string, { sum: number; count: number }>();

  for (const row of activeSpend) {
    const payee = row.payeeNormalized;
    if (row.monthKey === latestMonth) {
      latestTotals.set(
        payee,
        (latestTotals.get(payee) || 0) + (row.amountAbs as number)
      );
    }
    if (!allTotals.has(payee)) {
      allTotals.set(payee, { sum: 0, count: 0 });
    }
    const t = allTotals.get(payee)!;
    t.sum += row.amountAbs as number;
    t.count++;
  }

  for (const row of rows) {
    if (row.billStatus !== "active") {
      row.requiredAmountExact = 0;
      continue;
    }
    const payee = row.payeeNormalized;
    const latest = latestTotals.get(payee);
    const avg = allTotals.get(payee);
    row.requiredAmountExact =
      latest ?? (avg ? avg.sum / avg.count : 0);
  }

  return rows;
}

export function parseMonzoCsvContents(
  csvContents: { content: string; fileName: string }[]
): { rows: TransactionRow[]; rawCount: number } {
  const allRows: TransactionRow[] = [];

  if (csvContents.length === 0) {
    throw new Error("No CSV files provided");
  }

  for (let idx = 0; idx < csvContents.length; idx++) {
    const { content, fileName } = csvContents[idx];
    const accountLabel = idx === 0 ? "Personal" : "Joint";
    const rows = parse(content, {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
    }) as RawCsvRow[];

    for (const raw of rows) {
      const dateStr = raw.Date || "";
      const date = parseDateDDMMYYYY(dateStr);
      if (!date) continue;

      const amount = parseFloat(raw.Amount || "0") || 0;
      const txId =
        raw["Transaction ID"] || `gen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      allRows.push({
        id: txId,
        name: raw.Name || "",
        monzoCategory: raw.Category || "",
        payeeNormalized: "",
        categoryFinal: "",
        categoryGroup: "",
        isBillRule: false,
        confidenceScore: 0,
        confidenceReason: "",
        ruleIdApplied: "",
        date,
        monthKey: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
        day: date.getDate(),
        type: raw.Type || "",
        amount,
        amountAbs: Math.abs(amount),
        direction: amount < 0 ? "outflow" : "inflow",
        notes: raw.Notes || "",
        accountLabel,
        sourceFile: fileName,
        isSpend: false,
        isInternalTransfer: false,
        isBillCandidate: false,
        billStatus: "not_bill",
        requiredAmountExact: 0,
        typicalDay: null,
      } as TransactionRow);
    }
  }

  return { rows: allRows, rawCount: allRows.length };
}

function runPipelineShared(
  rows: TransactionRow[],
  rawCount: number,
  payeeOverrides: Map<string, string>
): { transactions: ProcessedTransaction[]; rawCount: number; spendCount: number; latestMonth: string } {
  const excluded = applyExclusions(rows);
  const categorized = categorize(excluded);
  const withOverrides = applyPayeeOverrides(categorized, payeeOverrides);
  const withBills = applyBillStatus(withOverrides);

  const billPayeeDays = new Map<string, number[]>();
  for (const row of withBills) {
    if (row.billStatus === "active" && row.isSpend) {
      const payee = row.payeeNormalized;
      if (!billPayeeDays.has(payee)) billPayeeDays.set(payee, []);
      billPayeeDays.get(payee)!.push(row.day as number);
    }
  }

  const typicalDayMap = new Map<string, number>();
  for (const [payee, days] of billPayeeDays) {
    days.sort((a, b) => a - b);
    const mid = Math.floor(days.length / 2);
    const median =
      days.length % 2 === 0
        ? Math.round((days[mid - 1] + days[mid]) / 2)
        : days[mid];
    typicalDayMap.set(payee, median);
  }

  for (const row of withBills) {
    if (row.billStatus === "active") {
      row.typicalDay = typicalDayMap.get(row.payeeNormalized) ?? null;
    }
  }

  const spendCount = withBills.filter((r) => r.isSpend).length;
  const allMonths = [...new Set(withBills.map((r) => r.monthKey as string))].sort();
  const latestMonth = allMonths[allMonths.length - 1] || "";

  return {
    transactions: withBills as unknown as ProcessedTransaction[],
    rawCount,
    spendCount,
    latestMonth,
  };
}

export function runFullPipelineFromContent(
  csvContents: { content: string; fileName: string }[],
  payeeOverrides: Map<string, string>
): { transactions: ProcessedTransaction[]; rawCount: number; spendCount: number; latestMonth: string } {
  const { rows, rawCount } = parseMonzoCsvContents(csvContents);
  return runPipelineShared(rows, rawCount, payeeOverrides);
}

export function runFullPipeline(
  csvPaths: string[],
  payeeOverrides: Map<string, string>
): { transactions: ProcessedTransaction[]; rawCount: number; spendCount: number; latestMonth: string } {
  const { rows, rawCount } = parseMonzoCsvs(csvPaths);
  const excluded = applyExclusions(rows);
  const categorized = categorize(excluded);
  const withOverrides = applyPayeeOverrides(categorized, payeeOverrides);
  const withBills = applyBillStatus(withOverrides);

  // Calculate typical day per payee for bills
  const billPayeeDays = new Map<string, number[]>();
  for (const row of withBills) {
    if (row.billStatus === "active" && row.isSpend) {
      const payee = row.payeeNormalized;
      if (!billPayeeDays.has(payee)) billPayeeDays.set(payee, []);
      billPayeeDays.get(payee)!.push(row.day as number);
    }
  }

  const typicalDayMap = new Map<string, number>();
  for (const [payee, days] of billPayeeDays) {
    days.sort((a, b) => a - b);
    const mid = Math.floor(days.length / 2);
    const median =
      days.length % 2 === 0
        ? Math.round((days[mid - 1] + days[mid]) / 2)
        : days[mid];
    typicalDayMap.set(payee, median);
  }

  for (const row of withBills) {
    if (row.billStatus === "active") {
      row.typicalDay = typicalDayMap.get(row.payeeNormalized) ?? null;
    }
  }

  const spendCount = withBills.filter((r) => r.isSpend).length;
  const allMonths = [...new Set(withBills.map((r) => r.monthKey as string))].sort();
  const latestMonth = allMonths[allMonths.length - 1] || "";

  return {
    transactions: withBills as unknown as ProcessedTransaction[],
    rawCount,
    spendCount,
    latestMonth,
  };
}
