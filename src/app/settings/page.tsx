"use client";

import { useEffect, useState, useCallback } from "react";

interface ImportRecord {
  date: string;
  rowCount: number;
  spendRows: number;
  latestMonth: string;
  files: string[];
}

interface StatusData {
  transactionCount: number;
  spendCount: number;
  latestImport: ImportRecord | null;
}

export default function SettingsPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [incomeAssumption, setIncomeAssumption] = useState(4300);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusData | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const [settingsRes, statusRes] = await Promise.all([
        fetch("/api/settings"),
        fetch("/api/status"),
      ]);
      const settings = await settingsRes.json();
      const statusData = await statusRes.json();
      setIncomeAssumption(settings.incomeAssumption || 4300);
      setStatus(statusData);
    } catch {
      console.error("Failed to fetch settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const runImport = async () => {
    if (files.length === 0) {
      setImportResult("Error: Please select CSV files first.");
      return;
    }
    setImporting(true);
    setImportResult(null);
    try {
      // Save income setting
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incomeAssumption }),
      });

      // Upload files
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));

      const res = await fetch("/api/import", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (data.error) {
        setImportResult(`Error: ${data.error}`);
      } else {
        setImportResult(
          `Imported ${data.rowCount} rows (${data.spendRows} spend). Latest month: ${data.latestMonth}`
        );
        fetchStatus();
      }
    } catch {
      setImportResult("Import failed - check console for details");
    } finally {
      setImporting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-500">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-slate-900 mb-6">Settings</h1>

      {/* Status card */}
      {status && (
        <div className="bg-white rounded-lg border border-slate-200 p-5 mb-6">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">
            Current Data
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-2xl font-bold text-slate-900">
                {status.transactionCount}
              </div>
              <div className="text-sm text-slate-500">Total transactions</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-900">
                {status.spendCount}
              </div>
              <div className="text-sm text-slate-500">Spend transactions</div>
            </div>
          </div>
          {status.latestImport && (
            <div className="mt-3 pt-3 border-t border-slate-100 text-sm text-slate-500">
              Last import: {new Date(status.latestImport.date).toLocaleString()} &middot;{" "}
              {status.latestImport.latestMonth}
            </div>
          )}
        </div>
      )}

      {/* CSV Upload */}
      <div className="bg-white rounded-lg border border-slate-200 p-5 mb-6">
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">
          CSV Files
        </h2>
        <p className="text-sm text-slate-500 mb-3">
          Upload Monzo CSV exports. First file = Personal, second = Joint.
        </p>
        <input
          type="file"
          accept=".csv"
          multiple
          onChange={(e) => setFiles(Array.from(e.target.files || []))}
          className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
        />
        {files.length > 0 && (
          <div className="mt-2 text-sm text-slate-600">
            {files.map((f, i) => (
              <div key={f.name}>{i === 0 ? "Personal" : "Joint"}: {f.name}</div>
            ))}
          </div>
        )}
      </div>

      {/* Income */}
      <div className="bg-white rounded-lg border border-slate-200 p-5 mb-6">
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">
          Income Assumption
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-lg text-slate-500">&pound;</span>
          <input
            type="number"
            value={incomeAssumption}
            onChange={(e) => setIncomeAssumption(parseFloat(e.target.value) || 0)}
            className="w-40 px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-sm text-slate-500">per month</span>
        </div>
      </div>

      {/* Actions */}
      <div className="mb-6">
        <button
          onClick={runImport}
          disabled={importing}
          className="w-full sm:w-auto px-6 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {importing ? "Importing..." : "Import / Refresh Data"}
        </button>
      </div>

      {/* Import result */}
      {importResult && (
        <div
          className={`p-4 rounded-md text-sm ${
            importResult.startsWith("Error")
              ? "bg-red-50 text-red-800 border border-red-200"
              : "bg-green-50 text-green-800 border border-green-200"
          }`}
        >
          {importResult}
        </div>
      )}
    </div>
  );
}
