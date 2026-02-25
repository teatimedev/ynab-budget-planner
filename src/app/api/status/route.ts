import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const txCount = await prisma.transaction.count();
    const spendCount = await prisma.transaction.count({
      where: { isSpend: true },
    });
    const latestImport = await prisma.import.findFirst({
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      transactionCount: txCount,
      spendCount,
      latestImport: latestImport
        ? {
            date: latestImport.createdAt,
            rowCount: latestImport.rowCount,
            spendRows: latestImport.spendRows,
            latestMonth: latestImport.latestMonth,
            files: JSON.parse(latestImport.sourceFiles),
          }
        : null,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
