import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runFullPipelineFromContent, ProcessedTransaction } from "@/lib/pipeline";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const files = formData.getAll("files") as File[];

    if (files.length === 0) {
      return NextResponse.json(
        { error: "No CSV files uploaded." },
        { status: 400 }
      );
    }

    // Read file contents
    const csvContents = await Promise.all(
      files.map(async (file) => ({
        content: await file.text(),
        fileName: file.name,
      }))
    );

    // Load payee overrides
    const overrides = await prisma.payeeOverride.findMany();
    const overrideMap = new Map(
      overrides.map((o) => [o.payeeNormalized, o.categoryFinal])
    );

    // Run pipeline
    const { transactions, rawCount, spendCount, latestMonth } =
      runFullPipelineFromContent(csvContents, overrideMap);

    // Clear existing transactions and insert new ones
    await prisma.transaction.deleteMany();

    // Insert in batches of 100
    const batchSize = 100;
    for (let i = 0; i < transactions.length; i += batchSize) {
      const batch = transactions.slice(i, i + batchSize);
      await prisma.transaction.createMany({
        data: batch.map((t: ProcessedTransaction) => ({
          id: t.id,
          date: t.date,
          monthKey: t.monthKey,
          day: t.day,
          name: t.name,
          payeeNormalized: t.payeeNormalized,
          type: t.type,
          amount: t.amount,
          amountAbs: t.amountAbs,
          direction: t.direction,
          monzoCategory: t.monzoCategory,
          notes: t.notes || null,
          accountLabel: t.accountLabel,
          sourceFile: t.sourceFile,
          categoryFinal: t.categoryFinal,
          categoryGroup: t.categoryGroup,
          isSpend: t.isSpend,
          isInternalTransfer: t.isInternalTransfer,
          isBillCandidate: t.isBillCandidate,
          billStatus: t.billStatus,
          confidenceScore: t.confidenceScore,
          confidenceReason: t.confidenceReason,
          ruleIdApplied: t.ruleIdApplied || null,
          requiredAmountExact: t.requiredAmountExact || null,
          typicalDay: t.typicalDay || null,
        })),
      });
    }

    // Apply bill overrides from user
    const billOverrides = await prisma.billOverride.findMany();
    for (const bo of billOverrides) {
      if (bo.status === "rejected") {
        await prisma.transaction.updateMany({
          where: { payeeNormalized: bo.payeeNormalized },
          data: { billStatus: "rejected" },
        });
      } else if (bo.status === "confirmed" || bo.status === "edited") {
        await prisma.transaction.updateMany({
          where: { payeeNormalized: bo.payeeNormalized, isBillCandidate: true },
          data: { billStatus: "active" },
        });
      }
    }

    // Record import
    await prisma.import.create({
      data: {
        sourceFiles: JSON.stringify(csvContents.map((c) => c.fileName)),
        rowCount: rawCount,
        spendRows: spendCount,
        latestMonth,
      },
    });

    return NextResponse.json({
      success: true,
      rowCount: rawCount,
      spendRows: spendCount,
      latestMonth,
      transactionsStored: transactions.length,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
