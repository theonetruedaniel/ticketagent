import { ZodError } from "zod";
import { authenticateExtension } from "@/lib/extension-auth";
import { ingestScan } from "@/lib/ingest";

export async function POST(request: Request) {
  const extension = await authenticateExtension(request);
  if (!extension) return Response.json({ error: "Invalid or revoked extension token" }, { status: 401 });

  try {
    const body = await request.json();
    if (
      body &&
      (body.source === "SeatGeek" || body.source === "StubHub") &&
      extension.browserAutomationAllowed !== true
    ) {
      return Response.json(
        { error: "This extension is not authorized for restricted marketplace browser scans" },
        { status: 403 }
      );
    }
    const result = await ingestScan(body, extension.userId, extension.tokenId);
    return Response.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json({ error: "Invalid scan batch", issues: error.issues }, { status: 400 });
    }
    console.error("Scan ingestion failed", error);
    return Response.json({ error: "Scan ingestion failed" }, { status: 500 });
  }
}
