import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    let settings = await prisma.settings.findFirst({ where: { id: 1 } });
    if (!settings) {
      settings = await prisma.settings.create({
        data: { id: 1, incomeAssumption: 4300, csvPaths: "" },
      });
    }
    return NextResponse.json(settings);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { incomeAssumption, csvPaths } = body;

    const settings = await prisma.settings.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        incomeAssumption: incomeAssumption ?? 4300,
        csvPaths: csvPaths ?? "",
      },
      update: {
        ...(incomeAssumption !== undefined && { incomeAssumption }),
        ...(csvPaths !== undefined && { csvPaths }),
      },
    });

    return NextResponse.json(settings);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
