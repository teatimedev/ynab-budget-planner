"use client";

import { useEffect, useState, useCallback } from "react";

interface BillTransaction {
  id: string;
  date: string;
  name: string;
  amount: number;
  monthKey: string;
  type: string;
}

interface MonthlyBreakdown {
  month: string;
  total: number;
}

interface Bill {
  payee: string;
  payeeNormalized: string;
  category: string;
  typicalDay: number;
  amount: number;
  avgMonthly: number;
  txCount: number;
  status: string;
  billStatus: string;
  monthlyBreakdown: MonthlyBreakdown[];
  transactions: BillTransaction[];
}

interface EditState {
  payeeNormalized: string;
  day: number;
  amount: number;
  category: string;
}

export default function BillsPage() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [totalMonthly, setTotalMonthly] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "needs_confirmation" | "confirmed">("all");
  const [editingBill, setEditingBill] = useState<EditState | null>(null);
  const [expandedBill, setExpandedBill] = useState<string | null>(null);
  const [monthFilter, setMonthFilter] = useState<Record<string, string | null>>({});

  const fetchBills = useCallback(async () => {
    try {
      const res = await fetch("/api/bills");
      const data = await res.json();
      setBills(data.bills || []);
      setTotalMonthly(data.totalMonthly || 0);
    } catch {
      console.error("Failed to fetch bills");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBills();
  }, [fetchBills]);

  const handleAction = async (payeeNormalized: string, action: string, customDay?: number, customAmount?: number, customCategory?: string) => {
    await fetch("/api/bills/override", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payeeNormalized, action, customDay, customAmount, customCategory }),
    });
    fetchBills();
    setEditingBill(null);
  };

  const filteredBills = bills.filter((b) => {
    if (filter === "all") return true;
    return b.status === filter;
  });

  const daySuffix = (d: number) => {
    if (d >= 11 && d <= 13) return "th";
    const last = d % 10;
    if (last === 1) return "st";
    if (last === 2) return "nd";
    if (last === 3) return "rd";
    return "th";
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-500">Loading bills...</div>
      </div>
    );
  }

  if (bills.length === 0) {
    return (
      <div className="text-center py-16">
        <h2 className="text-xl font-semibold text-slate-700 mb-2">No bills found</h2>
        <p className="text-slate-500">
          Go to <a href="/settings" className="text-blue-600 hover:underline">Settings</a> to configure CSV paths and import your data.
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
            <h1 className="text-2xl font-bold text-slate-900">Monthly Bills</h1>
            <p className="text-slate-500 text-sm mt-1">
              {bills.length} bills detected &middot; Tap a row to see transactions
            </p>
          </div>
          <div className="text-right">
            <div className="text-sm text-slate-500">Total monthly bills</div>
            <div className="text-3xl font-bold text-slate-900">
              &pound;{totalMonthly.toLocaleString("en-GB", { minimumFractionDigits: 2 })}
            </div>
          </div>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-1 mb-4">
        {(["all", "needs_confirmation", "confirmed"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-md text-xs sm:text-sm font-medium transition-colors ${
              filter === f
                ? "bg-blue-600 text-white"
                : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
            }`}
          >
            {f === "all" ? `All (${bills.length})` :
             f === "needs_confirmation" ? `Needs Review (${bills.filter(b => b.status === "needs_confirmation").length})` :
             `Confirmed (${bills.filter(b => b.status === "confirmed").length})`}
          </button>
        ))}
      </div>

      {/* Bills list */}
      <div className="space-y-2">
        {filteredBills.map((bill) => {
          const isExpanded = expandedBill === bill.payeeNormalized;
          return (
            <div
              key={bill.payeeNormalized}
              className="bg-white rounded-lg border border-slate-200 overflow-hidden"
            >
              {/* Bill header row */}
              <button
                onClick={() =>
                  setExpandedBill(isExpanded ? null : bill.payeeNormalized)
                }
                className="w-full px-3 sm:px-4 py-3 flex items-start sm:items-center gap-2 sm:gap-3 hover:bg-slate-50 transition-colors text-left"
              >
                <svg
                  className={`w-4 h-4 text-slate-400 transition-transform flex-shrink-0 mt-1 sm:mt-0 ${
                    isExpanded ? "rotate-90" : ""
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
                      <div className="font-medium text-slate-900 truncate">{bill.payee}</div>
                      <div className="text-xs text-slate-500">{bill.category}</div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="font-semibold text-slate-900">
                        &pound;{bill.amount.toFixed(2)}
                      </div>
                      <div className="text-xs text-slate-500">
                        {bill.typicalDay}{daySuffix(bill.typicalDay)} of month
                      </div>
                    </div>
                  </div>
                  {/* Mobile: status + avg on second line */}
                  <div className="flex items-center justify-between mt-1.5 sm:hidden">
                    <div>
                      {bill.status === "confirmed" ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          Confirmed
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                          Needs Review
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500">
                      avg &pound;{bill.avgMonthly.toFixed(2)}/mo
                    </div>
                  </div>
                  {/* Desktop: full stats row */}
                  <div className="hidden sm:flex items-center gap-6 mt-1">
                    <div className="text-xs text-slate-500">
                      avg &pound;{bill.avgMonthly.toFixed(2)}/mo
                    </div>
                    <div>
                      {bill.status === "confirmed" ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          Confirmed
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                          Needs Review
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
              {/* Actions */}
              <div className="flex items-center gap-1 px-3 sm:px-4 pb-2 sm:pb-0 sm:pt-0 flex-shrink-0">
                {bill.status !== "confirmed" && (
                  <button
                    onClick={() => handleAction(bill.payeeNormalized, "confirm")}
                    className="px-2 py-1 sm:px-2.5 sm:py-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded hover:bg-green-100 transition-colors"
                  >
                    Confirm
                  </button>
                )}
                <button
                  onClick={() =>
                    setEditingBill({
                      payeeNormalized: bill.payeeNormalized,
                      day: bill.typicalDay,
                      amount: bill.amount,
                      category: bill.category,
                    })
                  }
                  className="px-2 py-1 sm:px-2.5 sm:py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleAction(bill.payeeNormalized, "reject")}
                  className="px-2 py-1 sm:px-2.5 sm:py-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded hover:bg-red-100 transition-colors"
                >
                  Reject
                </button>
              </div>

              {/* Expanded transaction detail */}
              {isExpanded && (() => {
                const selectedMonth = monthFilter[bill.payeeNormalized] ?? null;
                const filteredTxs = (bill.transactions || []).filter(
                  (tx) => !selectedMonth || tx.monthKey === selectedMonth
                );
                const filteredSum = filteredTxs.reduce((sum, tx) => sum + tx.amount, 0);

                return (
                  <div className="border-t border-slate-200">
                    {/* Month filter bar */}
                    {bill.monthlyBreakdown && bill.monthlyBreakdown.length > 0 && (
                      <div className="bg-slate-50 px-4 py-2 border-b border-slate-100">
                        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                          Filter by month
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            onClick={() => setMonthFilter((prev) => ({ ...prev, [bill.payeeNormalized]: null }))}
                            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                              !selectedMonth
                                ? "bg-blue-600 text-white"
                                : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
                            }`}
                          >
                            All months
                          </button>
                          {bill.monthlyBreakdown.map((mb) => (
                            <button
                              key={mb.month}
                              onClick={() =>
                                setMonthFilter((prev) => ({
                                  ...prev,
                                  [bill.payeeNormalized]: prev[bill.payeeNormalized] === mb.month ? null : mb.month,
                                }))
                              }
                              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                                selectedMonth === mb.month
                                  ? "bg-blue-600 text-white"
                                  : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
                              }`}
                            >
                              {mb.month} &middot; &pound;{mb.total.toFixed(2)}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Individual transactions */}
                    <div className="overflow-x-auto">
                    <table className="w-full min-w-[400px]">
                      <thead>
                        <tr className="bg-slate-50">
                          <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500">Date</th>
                          <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500">Payee</th>
                          <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500">Type</th>
                          <th className="text-right px-4 py-2 text-xs font-semibold text-slate-500">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {filteredTxs.map((tx) => (
                          <tr key={tx.id} className="hover:bg-slate-50">
                            <td className="px-4 py-2 text-sm text-slate-600">
                              {tx.date}
                            </td>
                            <td className="px-4 py-2 text-sm text-slate-900">
                              {tx.name}
                            </td>
                            <td className="px-4 py-2 text-sm text-slate-500">
                              {tx.type}
                            </td>
                            <td className="px-4 py-2 text-sm text-right font-medium text-slate-900">
                              &pound;{tx.amount.toFixed(2)}
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
          );
        })}
      </div>

      {/* Edit modal */}
      {editingBill && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-5 sm:p-6 w-full max-w-md shadow-xl">
            <h3 className="text-lg font-semibold mb-4">Edit Bill</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Category name (for YNAB)
                </label>
                <input
                  type="text"
                  value={editingBill.category}
                  onChange={(e) =>
                    setEditingBill({ ...editingBill, category: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Day of month
                </label>
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={editingBill.day}
                  onChange={(e) =>
                    setEditingBill({ ...editingBill, day: parseInt(e.target.value) || 1 })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Amount (&pound;)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  value={editingBill.amount}
                  onChange={(e) =>
                    setEditingBill({ ...editingBill, amount: parseFloat(e.target.value) || 0 })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setEditingBill(null)}
                className="px-4 py-2 text-sm text-slate-600 bg-slate-100 rounded-md hover:bg-slate-200"
              >
                Cancel
              </button>
              <button
                onClick={() =>
                  handleAction(
                    editingBill.payeeNormalized,
                    "edit",
                    editingBill.day,
                    editingBill.amount,
                    editingBill.category
                  )
                }
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
