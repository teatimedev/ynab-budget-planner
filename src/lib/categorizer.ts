import * as fs from "fs";
import * as path from "path";

function loadCategoryRules(): { rules: Array<{ id: string; pattern: string; category: string; group: string; is_bill: boolean; confidence: number }> } {
  const filePath = path.join(process.cwd(), "config", "category_rules.json");
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

interface Rule {
  id: string;
  pattern: RegExp;
  category: string;
  group: string;
  isBill: boolean;
  confidence: number;
}

interface CategorizedRow {
  categoryFinal: string;
  categoryGroup: string;
  isBillRule: boolean;
  confidenceScore: number;
  confidenceReason: string;
  ruleIdApplied: string;
}

const FALLBACK_CATEGORY_MAP: Record<
  string,
  [string, string, boolean, number]
> = {
  Groceries: ["Groceries (non-Spar)", "variable", false, 0.55],
  Entertainment: ["Entertainment & Activities", "variable", false, 0.55],
  Transport: ["Transport", "variable", false, 0.55],
  Shopping: ["Shopping (general)", "variable", false, 0.55],
  Finances: ["Debt Repayments / Finance Plans", "required_bill", true, 0.5],
  General: ["Other - General", "variable", false, 0.45],
};

export function normalizePayee(value: string): string {
  let text = (value || "").trim().toLowerCase();
  text = text.replace(/[^a-z0-9+& ]+/g, " ");
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

let _cachedRules: Rule[] | null = null;

function loadRules(): Rule[] {
  if (_cachedRules) return _cachedRules;
  const categoryRulesJson = loadCategoryRules();
  _cachedRules = categoryRulesJson.rules.map((raw) => ({
    id: raw.id,
    pattern: new RegExp(raw.pattern, "i"),
    category: raw.category,
    group: raw.group,
    isBill: raw.is_bill,
    confidence: raw.confidence,
  }));
  return _cachedRules;
}

function matchRule(payeeNorm: string): Rule | null {
  const rules = loadRules();
  for (const rule of rules) {
    if (rule.pattern.test(payeeNorm)) {
      return rule;
    }
  }
  return null;
}

function sequenceMatcherRatio(a: string, b: string): number {
  if (a === b) return 1.0;
  if (!a || !b) return 0.0;

  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;

  if (longer.length === 0) return 1.0;

  // Simple LCS-based similarity (matching SequenceMatcher behavior)
  const m = shorter.length;
  const n = longer.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0)
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (shorter[i - 1] === longer[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const lcsLength = dp[m][n];
  return (2.0 * lcsLength) / (m + n);
}

export interface TransactionRow {
  id: string;
  name: string;
  monzoCategory: string;
  payeeNormalized: string;
  categoryFinal: string;
  categoryGroup: string;
  isBillRule: boolean;
  confidenceScore: number;
  confidenceReason: string;
  ruleIdApplied: string;
  [key: string]: unknown;
}

export function categorize(rows: TransactionRow[]): TransactionRow[] {
  // Pass 1: deterministic rules + fallback
  for (const row of rows) {
    row.payeeNormalized = normalizePayee(row.name);
    row.categoryFinal = "Unmapped - Needs Review";
    row.categoryGroup = "variable";
    row.isBillRule = false;
    row.confidenceScore = 0;
    row.confidenceReason = "none";
    row.ruleIdApplied = "";

    const rule = matchRule(row.payeeNormalized);
    if (rule) {
      row.categoryFinal = rule.category;
      row.categoryGroup = rule.group;
      row.isBillRule = rule.isBill;
      row.confidenceScore = rule.confidence;
      row.confidenceReason = "rule";
      row.ruleIdApplied = rule.id;
      continue;
    }

    const fallback = FALLBACK_CATEGORY_MAP[row.monzoCategory];
    if (fallback) {
      const [category, group, isBill, confidence] = fallback;
      row.categoryFinal = category;
      row.categoryGroup = group;
      row.isBillRule = isBill;
      row.confidenceScore = confidence;
      row.confidenceReason = "monzo_fallback";
      row.ruleIdApplied = "fallback";
    }
  }

  // Pass 2: fuzzy matching for low confidence rows
  const knownMap = new Map<
    string,
    { category: string; group: string; isBill: boolean }
  >();
  for (const row of rows) {
    if (row.confidenceScore >= 0.9 && row.payeeNormalized) {
      if (!knownMap.has(row.payeeNormalized)) {
        knownMap.set(row.payeeNormalized, {
          category: row.categoryFinal,
          group: row.categoryGroup,
          isBill: row.isBillRule,
        });
      }
    }
  }

  if (knownMap.size > 0) {
    const knownKeys = Array.from(knownMap.keys());
    for (const row of rows) {
      if (row.confidenceScore >= 0.7 || !row.payeeNormalized) continue;

      let bestKey: string | null = null;
      let bestScore = 0;
      for (const candidate of knownKeys) {
        const score = sequenceMatcherRatio(row.payeeNormalized, candidate);
        if (score > bestScore) {
          bestScore = score;
          bestKey = candidate;
        }
      }

      if (bestKey && bestScore >= 0.88) {
        const match = knownMap.get(bestKey)!;
        row.categoryFinal = match.category;
        row.categoryGroup = match.group;
        row.isBillRule = match.isBill;
        row.confidenceScore = Math.min(0.85, Math.max(0.7, bestScore));
        row.confidenceReason = "fuzzy_payee";
        row.ruleIdApplied = `fuzzy:${bestKey}`;
      }
    }
  }

  return rows;
}

export function applyPayeeOverrides(
  rows: TransactionRow[],
  overrides: Map<string, string>
): TransactionRow[] {
  for (const row of rows) {
    const override = overrides.get(row.payeeNormalized);
    if (override) {
      row.categoryFinal = override;
      row.confidenceScore = 1.0;
      row.confidenceReason = "user_override";
      row.ruleIdApplied = "payee_override";
    }
  }
  return rows;
}
