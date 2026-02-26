import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const report = await request.json();
    const userAgent = request.headers.get("user-agent") || "unknown";
    const timestamp = new Date().toISOString();
    
    console.log("[CSP Violation]", {
      timestamp,
      userAgent,
      report
    });
    
    return NextResponse.json({ received: true }, { status: 200 });
  } catch (error) {
    console.error("[CSP Report] Failed to process report:", error);
    return NextResponse.json({ error: "Invalid report format" }, { status: 400 });
  }
}