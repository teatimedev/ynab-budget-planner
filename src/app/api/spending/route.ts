import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const timeframe = searchParams.get("timeframe") || "all";

    let transactions = await prisma.transaction.findMany({
      where: {
        isSpend: true,
        isInternalTransfer: false,
        OR: [
          { billStatus: "not_bill" },
          { billStatus: null },
        ],
      },
    });

    if (transactions.length === 0) {
      return NextResponse.json({
        categories: [],
        weeklyBudget: 0,
        transactions: [],
      });
    }

    const allMonths = [...new Set(transactions.map((t) => t.monthKey))].sort();
    const latestMonth = allMonths[allMonths.length - 1];

    // Apply timeframe filter
    if (timeframe === "this_month") {
      transactions = transactions.filter((t) => t.monthKey === latestMonth);
    } else if (timeframe === "last_3") {
      const keep = new Set(allMonths.slice(-3));
      transactions = transactions.filter((t) => keep.has(t.monthKey));
    }

    if (transactions.length === 0) {
      return NextResponse.json({
        categories: [],
        weeklyBudget: 0,
        transactions: [],
      });
    }

    const filteredMonths = [...new Set(transactions.map((t) => t.monthKey))];
    const monthCount = Math.max(1, filteredMonths.length);

    const dates = transactions.map((t) => new Date(t.date).getTime());
    const minDate = Math.min(...dates);
    const maxDate = Math.max(...dates);
    const daySpan = Math.max(1, (maxDate - minDate) / (1000 * 60 * 60 * 24) + 1);
    const weekCount = Math.max(1, daySpan / 7);

    // Group by category
    const catGroups = new Map<string, { totalSpend: number; txCount: number }>();
    for (const t of transactions) {
      if (!catGroups.has(t.categoryFinal)) {
        catGroups.set(t.categoryFinal, { totalSpend: 0, txCount: 0 });
      }
      const g = catGroups.get(t.categoryFinal)!;
      g.totalSpend += t.amountAbs;
      g.txCount++;
    }

    // This month totals
    const thisMonthTotals = new Map<string, number>();
    for (const t of transactions.filter((t) => t.monthKey === latestMonth)) {
      thisMonthTotals.set(
        t.categoryFinal,
        (thisMonthTotals.get(t.categoryFinal) || 0) + t.amountAbs
      );
    }

    const categories = [];
    for (const [category, stats] of catGroups) {
      const avgMonthly = stats.totalSpend / monthCount;
      const avgWeekly = stats.totalSpend / weekCount;

      categories.push({
        category,
        avgMonthly: Math.round(avgMonthly * 100) / 100,
        avgWeekly: Math.round(avgWeekly * 100) / 100,
        txCount: stats.txCount,
        thisMonthActual: Math.round((thisMonthTotals.get(category) || 0) * 100) / 100,
        target: Math.round(avgWeekly * 100) / 100,
      });
    }

    categories.sort((a, b) => b.avgMonthly - a.avgMonthly);

    const weeklyBudget = categories.reduce((sum, c) => sum + c.target, 0);

    // Return transactions grouped by category for drill-down
    const txsByCategory: Record<string, Array<{
      id: string;
      date: string;
      name: string;
      amount: number;
      monthKey: string;
      categoryFinal: string;
      payeeNormalized: string;
    }>> = {};

    for (const t of transactions) {
      if (!txsByCategory[t.categoryFinal]) {
        txsByCategory[t.categoryFinal] = [];
      }
      txsByCategory[t.categoryFinal].push({
        id: t.id,
        date: new Date(t.date).toISOString().split("T")[0],
        name: t.name,
        amount: t.amountAbs,
        monthKey: t.monthKey,
        categoryFinal: t.categoryFinal,
        payeeNormalized: t.payeeNormalized,
      });
    }

    // Sort transactions within each category by date desc
    for (const cat of Object.keys(txsByCategory)) {
      txsByCategory[cat].sort((a, b) => b.date.localeCompare(a.date));
    }

    return NextResponse.json({
      categories,
      weeklyBudget: Math.round(weeklyBudget * 100) / 100,
      transactions: txsByCategory,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
