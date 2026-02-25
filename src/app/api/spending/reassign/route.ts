import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { payeeNormalized, newCategory } = body;

    if (!payeeNormalized || !newCategory) {
      return NextResponse.json(
        { error: "payeeNormalized and newCategory are required" },
        { status: 400 }
      );
    }

    // Create/update PayeeOverride
    await prisma.payeeOverride.upsert({
      where: { payeeNormalized },
      create: {
        payeeNormalized,
        categoryFinal: newCategory,
      },
      update: {
        categoryFinal: newCategory,
        updatedAt: new Date(),
      },
    });

    // Update all transactions with this payee
    const updated = await prisma.transaction.updateMany({
      where: { payeeNormalized },
      data: {
        categoryFinal: newCategory,
        confidenceScore: 1.0,
        confidenceReason: "user_override",
        ruleIdApplied: "payee_override",
      },
    });

    return NextResponse.json({
      success: true,
      updatedCount: updated.count,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
