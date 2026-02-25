import { ProcessedTransaction } from "./pipeline";

export interface BillSummary {
  payee: string;
  payeeNormalized: string;
  category: string;
  typicalDay: number;
  requiredExact: number;
  avgMonthly: number;
  minMonthly: number;
  maxMonthly: number;
  txCount: number;
  billStatus: string;
}

export interface VariableCategory {
  category: string;
  avgMonthly: number;
  avgWeekly: number;
  txCount: number;
  thisMonthActual: number;
  target: number; // user-editable, defaults to avgWeekly
}

export function buildBillsSummary(
  transactions: ProcessedTransaction[]
): BillSummary[] {
  const spend = transactions.filter(
    (t) => t.isSpend && t.billStatus === "active"
  );
  if (spend.length === 0) return [];

  const allMonths = [...new Set(spend.map((t) => t.monthKey))].sort();
  const latestMonth = allMonths[allMonths.length - 1];

  // Group by payee
  const payeeGroups = new Map<string, ProcessedTransaction[]>();
  for (const t of spend) {
    if (!payeeGroups.has(t.payeeNormalized)) {
      payeeGroups.set(t.payeeNormalized, []);
    }
    payeeGroups.get(t.payeeNormalized)!.push(t);
  }

  const results: BillSummary[] = [];

  for (const [payeeNorm, txs] of payeeGroups) {
    // Monthly totals
    const monthlyTotals = new Map<string, number>();
    for (const t of txs) {
      monthlyTotals.set(
        t.monthKey,
        (monthlyTotals.get(t.monthKey) || 0) + t.amountAbs
      );
    }

    const monthAmounts = Array.from(monthlyTotals.values());
    const avg =
      monthAmounts.reduce((a, b) => a + b, 0) / monthAmounts.length;
    const min = Math.min(...monthAmounts);
    const max = Math.max(...monthAmounts);

    const latestAmount = monthlyTotals.get(latestMonth) ?? avg;

    // Typical day (median)
    const days = txs.map((t) => t.day).sort((a, b) => a - b);
    const mid = Math.floor(days.length / 2);
    const typicalDay =
      days.length % 2 === 0
        ? Math.round((days[mid - 1] + days[mid]) / 2)
        : days[mid];

    // Most common payee name
    const nameCounts = new Map<string, number>();
    for (const t of txs) {
      nameCounts.set(t.name, (nameCounts.get(t.name) || 0) + 1);
    }
    const payeeName = [...nameCounts.entries()].sort(
      (a, b) => b[1] - a[1]
    )[0][0];

    // Most common category
    const catCounts = new Map<string, number>();
    for (const t of txs) {
      catCounts.set(
        t.categoryFinal,
        (catCounts.get(t.categoryFinal) || 0) + 1
      );
    }
    const category = [...catCounts.entries()].sort(
      (a, b) => b[1] - a[1]
    )[0][0];

    results.push({
      payee: payeeName,
      payeeNormalized: payeeNorm,
      category,
      typicalDay,
      requiredExact: Math.round(latestAmount * 100) / 100,
      avgMonthly: Math.round(avg * 100) / 100,
      minMonthly: Math.round(min * 100) / 100,
      maxMonthly: Math.round(max * 100) / 100,
      txCount: txs.length,
      billStatus: "active",
    });
  }

  // Sort by typical day, then by amount descending
  results.sort((a, b) => {
    if (a.typicalDay !== b.typicalDay) return a.typicalDay - b.typicalDay;
    return b.requiredExact - a.requiredExact;
  });

  return results;
}

export function buildVariableSummary(
  transactions: ProcessedTransaction[],
  timeframe: "this_month" | "last_3" | "all" = "all"
): VariableCategory[] {
  let base = transactions.filter(
    (t) => t.isSpend && t.billStatus !== "active" && !t.isInternalTransfer
  );

  if (base.length === 0) return [];

  const allMonths = [...new Set(base.map((t) => t.monthKey))].sort();
  const latestMonth = allMonths[allMonths.length - 1];

  // Apply timeframe filter
  if (timeframe === "this_month") {
    base = base.filter((t) => t.monthKey === latestMonth);
  } else if (timeframe === "last_3") {
    const keep = new Set(allMonths.slice(-3));
    base = base.filter((t) => keep.has(t.monthKey));
  }

  if (base.length === 0) return [];

  const filteredMonths = [...new Set(base.map((t) => t.monthKey))];
  const monthCount = Math.max(1, filteredMonths.length);

  // Calculate day span for weekly averages
  const dates = base.map((t) => t.date.getTime());
  const minDate = Math.min(...dates);
  const maxDate = Math.max(...dates);
  const daySpan = Math.max(1, (maxDate - minDate) / (1000 * 60 * 60 * 24) + 1);
  const weekCount = Math.max(1, daySpan / 7);

  // Group by category
  const catGroups = new Map<
    string,
    { totalSpend: number; txCount: number }
  >();
  for (const t of base) {
    if (!catGroups.has(t.categoryFinal)) {
      catGroups.set(t.categoryFinal, { totalSpend: 0, txCount: 0 });
    }
    const g = catGroups.get(t.categoryFinal)!;
    g.totalSpend += t.amountAbs;
    g.txCount++;
  }

  // This month actuals
  const thisMonthTotals = new Map<string, number>();
  for (const t of base.filter((t) => t.monthKey === latestMonth)) {
    thisMonthTotals.set(
      t.categoryFinal,
      (thisMonthTotals.get(t.categoryFinal) || 0) + t.amountAbs
    );
  }

  const results: VariableCategory[] = [];

  for (const [category, stats] of catGroups) {
    const avgMonthly = stats.totalSpend / monthCount;
    const avgWeekly = stats.totalSpend / weekCount;

    results.push({
      category,
      avgMonthly: Math.round(avgMonthly * 100) / 100,
      avgWeekly: Math.round(avgWeekly * 100) / 100,
      txCount: stats.txCount,
      thisMonthActual: Math.round(
        (thisMonthTotals.get(category) || 0) * 100
      ) / 100,
      target: Math.round(avgWeekly * 100) / 100,
    });
  }

  results.sort((a, b) => b.avgMonthly - a.avgMonthly);
  return results;
}
