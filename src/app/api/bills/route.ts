import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const transactions = await prisma.transaction.findMany({
      where: {
        isSpend: true,
        isBillCandidate: true,
        billStatus: { not: "not_bill" },
      },
    });

    if (transactions.length === 0) {
      return NextResponse.json({ bills: [], totalMonthly: 0 });
    }

    // Get bill overrides
    const billOverrides = await prisma.billOverride.findMany();
    const overrideMap = new Map(
      billOverrides.map((bo) => [bo.payeeNormalized, bo])
    );

    // Group by payee
    const payeeGroups = new Map<string, typeof transactions>();
    for (const t of transactions) {
      if (t.billStatus === "rejected") continue;
      if (!payeeGroups.has(t.payeeNormalized)) {
        payeeGroups.set(t.payeeNormalized, []);
      }
      payeeGroups.get(t.payeeNormalized)!.push(t);
    }

    const allMonths = [...new Set(transactions.map((t) => t.monthKey))].sort();
    const latestMonth = allMonths[allMonths.length - 1];

    const bills = [];

    for (const [payeeNorm, txs] of payeeGroups) {
      const override = overrideMap.get(payeeNorm);

      // Monthly totals
      const monthlyTotals = new Map<string, number>();
      for (const t of txs) {
        monthlyTotals.set(
          t.monthKey,
          (monthlyTotals.get(t.monthKey) || 0) + t.amountAbs
        );
      }
      const monthAmounts = Array.from(monthlyTotals.values());
      const avg = monthAmounts.reduce((a, b) => a + b, 0) / monthAmounts.length;
      const latestAmount = monthlyTotals.get(latestMonth) ?? avg;

      // Typical day (median)
      const days = txs.map((t) => t.day).sort((a, b) => a - b);
      const mid = Math.floor(days.length / 2);
      const typicalDay =
        days.length % 2 === 0
          ? Math.round((days[mid - 1] + days[mid]) / 2)
          : days[mid];

      // Most common name and category
      const nameCounts = new Map<string, number>();
      const catCounts = new Map<string, number>();
      for (const t of txs) {
        nameCounts.set(t.name, (nameCounts.get(t.name) || 0) + 1);
        catCounts.set(t.categoryFinal, (catCounts.get(t.categoryFinal) || 0) + 1);
      }
      const payeeName = [...nameCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const category = [...catCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];

      const isConfirmed = override?.status === "confirmed" || override?.status === "edited";
      const isRejected = override?.status === "rejected";

      if (isRejected) continue;

      // Build per-month breakdown
      const monthlyBreakdown = [...monthlyTotals.entries()]
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([month, total]) => ({ month, total: Math.round(total * 100) / 100 }));

      // Individual transactions sorted by date desc
      const billTransactions = txs
        .map((t) => ({
          id: t.id,
          date: new Date(t.date).toISOString().split("T")[0],
          name: t.name,
          amount: t.amountAbs,
          monthKey: t.monthKey,
          type: t.type,
        }))
        .sort((a, b) => b.date.localeCompare(a.date));

      bills.push({
        payee: payeeName,
        payeeNormalized: payeeNorm,
        category: override?.customCategory || category,
        typicalDay: override?.customDay ?? typicalDay,
        amount: override?.customAmount ?? Math.round(latestAmount * 100) / 100,
        avgMonthly: Math.round(avg * 100) / 100,
        txCount: txs.length,
        status: isConfirmed ? "confirmed" : "needs_confirmation",
        billStatus: txs[0].billStatus,
        monthlyBreakdown,
        transactions: billTransactions,
      });
    }

    // Sort by typical day, then amount descending
    bills.sort((a, b) => {
      if (a.typicalDay !== b.typicalDay) return a.typicalDay - b.typicalDay;
      return b.amount - a.amount;
    });

    const totalMonthly = bills.reduce((sum, b) => sum + b.amount, 0);

    return NextResponse.json({
      bills,
      totalMonthly: Math.round(totalMonthly * 100) / 100,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
