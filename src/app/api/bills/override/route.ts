import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { payeeNormalized, action, customDay, customAmount, customCategory } = body;

    if (!payeeNormalized || !action) {
      return NextResponse.json(
        { error: "payeeNormalized and action are required" },
        { status: 400 }
      );
    }

    if (action === "confirm") {
      await prisma.billOverride.upsert({
        where: { payeeNormalized },
        create: {
          payeeNormalized,
          status: "confirmed",
        },
        update: {
          status: "confirmed",
          updatedAt: new Date(),
        },
      });
    } else if (action === "reject") {
      await prisma.billOverride.upsert({
        where: { payeeNormalized },
        create: {
          payeeNormalized,
          status: "rejected",
        },
        update: {
          status: "rejected",
          updatedAt: new Date(),
        },
      });
      // Also update transaction records
      await prisma.transaction.updateMany({
        where: { payeeNormalized },
        data: { billStatus: "rejected" },
      });
    } else if (action === "edit") {
      await prisma.billOverride.upsert({
        where: { payeeNormalized },
        create: {
          payeeNormalized,
          status: "edited",
          customDay: customDay ?? null,
          customAmount: customAmount ?? null,
          customCategory: customCategory ?? null,
        },
        update: {
          status: "edited",
          customDay: customDay ?? null,
          customAmount: customAmount ?? null,
          customCategory: customCategory ?? null,
          updatedAt: new Date(),
        },
      });
    } else {
      return NextResponse.json(
        { error: "Invalid action. Use: confirm, reject, or edit" },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
