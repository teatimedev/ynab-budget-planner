"use client";

import { useEffect, useState, useCallback } from "react";

interface Category {
  category: string;
  avgMonthly: number;
  avgWeekly: number;
  txCount: number;
  thisMonthActual: number;
  target: number;
}

interface Transaction {
  id: string;
  date: string;
  name: string;
  amount: number;
  monthKey: string;
  categoryFinal: string;
  payeeNormalized: string;
}

export default function SpendingPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [weeklyBudget, setWeeklyBudget] = useState(0);
  const [transactions, setTransactions] = useState<Record<string, Transaction[]>>({});
  const [loading, setLoading] = useState(true);
  const [timeframe, setTimeframe] = useState<"all" | "last_3" | "this_month">("all");
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [reassigning, setReassigning] = useState<string | null>(null);
  const [newCategory, setNewCategory] = useState("");
  const [monthFilter, setMonthFilter] = useState<Record<string, string | null>>({});

  const fetchSpending = useCallback(async () => {
    try {
      const res = await fetch(`/api/spending?timeframe=${timeframe}`);
      const data = await res.json();
      setCategories(data.categories || []);
      setWeeklyBudget(data.weeklyBudget || 0);
      setTransactions(data.transactions || {});
    } catch {
      console.error("Failed to fetch spending");
    } finally {
      setLoading(false);
    }
  }, [timeframe]);

  useEffect(() => {
    setLoading(true);
    fetchSpending();
  }, [fetchSpending]);

  const handleReassign = async (payeeNormalized: string) => {
    if (!newCategory.trim()) return;
    await fetch("/api/spending/reassign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payeeNormalized, newCategory: newCategory.trim() }),
    });
    setReassigning(null);
    setNewCategory("");
    fetchSpending();
  };

  const allCategoryNames = categories.map((c) => c.category).sort();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-500">Loading spending data...</div>
      </div>
    );
  }

  if (categories.length === 0) {
    return (
      <div className="text-center py-16">
        <h2 className="text-xl font-semibold text-slate-700 mb-2">No spending data</h2>
        <p className="text-slate-500">
          Go to <a href="/settings" className="text-blue-600 hover:underline">Settings</a> to import your data.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Summary bar */}
      <div className="bg-white rounded-lg border border-slate-200 p-5 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Weekly Spending</h1>
            <p className="text-slate-500 text-sm mt-1">
              {categories.length} categories &middot; Set your YNAB targets
            </p>
          </div>
          <div className="text-right">
            <div className="text-sm text-slate-500">Total weekly target</div>
            <div className="text-3xl font-bold text-slate-900">
              &pound;{weeklyBudget.toLocaleString("en-GB", { minimumFractionDigits: 2 })}
            </div>
          </div>
        </div>
      </div>

      {/* Timeframe selector */}
      <div className="flex flex-wrap gap-1 mb-4">
        {([
          ["all", "All"],
          ["last_3", "Last 3 Months"],
          ["this_month", "This Month"],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setTimeframe(value)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              timeframe === value
                ? "bg-blue-600 text-white"
                : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Category list */}
      <div className="space-y-2">
        {categories.map((cat) => (
          <div
            key={cat.category}
            className="bg-white rounded-lg border border-slate-200 overflow-hidden"
          >
            {/* Category header row */}
            <button
              onClick={() =>
                setExpandedCategory(
                  expandedCategory === cat.category ? null : cat.category
                )
              }
              className="w-full px-3 sm:px-4 py-3 flex items-start sm:items-center gap-2 sm:gap-4 hover:bg-slate-50 transition-colors text-left"
            >
              <svg
                className={`w-4 h-4 text-slate-400 transition-transform flex-shrink-0 mt-1 sm:mt-0 ${
                  expandedCategory === cat.category ? "rotate-90" : ""
                }`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
              <div className="min-w-0 flex-1">
                <div className="flex items-start sm:items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900 truncate">{cat.category}</div>
                    <div className="text-xs text-slate-500">
                      {cat.txCount} transactions
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-sm font-bold text-blue-600">
                      &pound;{cat.target.toFixed(2)}/wk
                    </div>
                    <div className="text-xs text-slate-500">target</div>
                  </div>
                </div>
                {/* Mobile: avg stats on second line */}
                <div className="flex items-center gap-4 mt-1 sm:hidden text-xs text-slate-500">
                  <span>&pound;{cat.avgWeekly.toFixed(2)}/wk avg</span>
                  <span>&pound;{cat.avgMonthly.toFixed(2)}/mo avg</span>
                </div>
                {/* Desktop: full stats */}
                <div className="hidden sm:flex items-center gap-6 mt-1 text-xs text-slate-500">
                  <span>Avg weekly: &pound;{cat.avgWeekly.toFixed(2)}</span>
                  <span>Avg monthly: &pound;{cat.avgMonthly.toFixed(2)}</span>
                </div>
              </div>
            </button>

            {/* Expanded transactions */}
            {expandedCategory === cat.category && (() => {
              const allTxs = transactions[cat.category] || [];
              const selectedMonth = monthFilter[cat.category] ?? null;
              const filteredTxs = allTxs.filter(
                (tx) => !selectedMonth || tx.monthKey === selectedMonth
              );
              const filteredSum = filteredTxs.reduce((sum, tx) => sum + tx.amount, 0);

              // Build month totals for filter buttons
              const monthTotals = new Map<string, number>();
              for (const tx of allTxs) {
                monthTotals.set(tx.monthKey, (monthTotals.get(tx.monthKey) || 0) + tx.amount);
              }
              const months = [...monthTotals.entries()].sort((a, b) => b[0].localeCompare(a[0]));

              return (
                <div className="border-t border-slate-200">
                  {/* Month filter bar */}
                  {months.length > 1 && (
                    <div className="bg-slate-50 px-4 py-2 border-b border-slate-100">
                      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                        Filter by month
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          onClick={() => setMonthFilter((prev) => ({ ...prev, [cat.category]: null }))}
                          className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                            !selectedMonth
                              ? "bg-blue-600 text-white"
                              : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
                          }`}
                        >
                          All months
                        </button>
                        {months.map(([month, total]) => (
                          <button
                            key={month}
                            onClick={() =>
                              setMonthFilter((prev) => ({
                                ...prev,
                                [cat.category]: prev[cat.category] === month ? null : month,
                              }))
                            }
                            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                              selectedMonth === month
                                ? "bg-blue-600 text-white"
                                : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
                            }`}
                          >
                            {month} &middot; &pound;{total.toFixed(2)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="overflow-x-auto">
                  <table className="w-full min-w-[400px]">
                    <thead>
                      <tr className="bg-slate-50">
                        <th className="text-left px-3 sm:px-4 py-2 text-xs font-semibold text-slate-500">Date</th>
                        <th className="text-left px-3 sm:px-4 py-2 text-xs font-semibold text-slate-500">Payee</th>
                        <th className="text-right px-3 sm:px-4 py-2 text-xs font-semibold text-slate-500">Amount</th>
                        <th className="text-right px-3 sm:px-4 py-2 text-xs font-semibold text-slate-500">Category</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {filteredTxs.map((tx) => (
                        <tr key={tx.id} className="hover:bg-slate-50">
                          <td className="px-3 sm:px-4 py-2 text-sm text-slate-600 whitespace-nowrap">
                            {tx.date}
                          </td>
                          <td className="px-3 sm:px-4 py-2 text-sm text-slate-900">
                            {tx.name}
                          </td>
                          <td className="px-3 sm:px-4 py-2 text-sm text-right font-medium text-slate-900 whitespace-nowrap">
                            &pound;{tx.amount.toFixed(2)}
                          </td>
                          <td className="px-3 sm:px-4 py-2 text-right">
                            {reassigning === tx.payeeNormalized ? (
                              <div className="flex flex-wrap items-center justify-end gap-1">
                                <select
                                  value={newCategory}
                                  onChange={(e) => setNewCategory(e.target.value)}
                                  className="text-xs px-2 py-1 border border-slate-300 rounded"
                                >
                                  <option value="">Select...</option>
                                  {allCategoryNames.map((name) => (
                                    <option key={name} value={name}>
                                      {name}
                                    </option>
                                  ))}
                                  <option value="__custom__">Custom...</option>
                                </select>
                                {newCategory === "__custom__" && (
                                  <input
                                    type="text"
                                    placeholder="Category name"
                                    className="text-xs px-2 py-1 border border-slate-300 rounded w-28"
                                    onChange={(e) => setNewCategory(e.target.value)}
                                  />
                                )}
                                <button
                                  onClick={() => handleReassign(tx.payeeNormalized)}
                                  className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
                                >
                                  Save
                                </button>
                                <button
                                  onClick={() => {
                                    setReassigning(null);
                                    setNewCategory("");
                                  }}
                                  className="text-xs px-2 py-1 text-slate-500 hover:text-slate-700"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => {
                                  setReassigning(tx.payeeNormalized);
                                  setNewCategory(tx.categoryFinal);
                                }}
                                className="text-xs px-2 py-1 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded"
                              >
                                {tx.categoryFinal}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                  <div className="px-4 py-2 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-xs text-slate-500">
                      {filteredTxs.length} transaction{filteredTxs.length !== 1 ? "s" : ""}
                      {selectedMonth ? ` in ${selectedMonth}` : " total"}
                    </span>
                    <span className="text-sm font-semibold text-slate-900">
                      Sum: &pound;{filteredSum.toFixed(2)}
                    </span>
                  </div>
                </div>
              );
            })()}
          </div>
        ))}
      </div>
    </div>
  );
}
