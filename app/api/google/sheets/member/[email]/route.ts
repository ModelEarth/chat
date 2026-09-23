import "server-only";
import { NextResponse } from "next/server";
import { corsErrorJson, corsPreflight, withCors } from "@/lib/cors";
import { getMemberByEmail } from "@/lib/google/sheets-member";

export const runtime = "nodejs";

// Node's counterpart to team's Rust /api/google/sheets/member/{email}
// (get_member_by_email) — unlike Rust's stub, this actually reads the sheet.
export async function OPTIONS() {
  return corsPreflight();
}

export async function GET(_request: Request, { params }: { params: Promise<{ email: string }> }) {
  const { email } = await params;

  try {
    const result = await getMemberByEmail(decodeURIComponent(email));

    switch (result.status) {
      case "not_configured":
        return corsErrorJson(400, {
          success: false,
          error: "Google Sheets not configured. Please update spreadsheetId in config.yaml",
          email,
        });
      case "no_credentials":
        return corsErrorJson(400, {
          success: false,
          error: "GOOGLE_SERVICE_KEY / GOOGLE_SERVICE_KEY_JSON not set or invalid in the local env file (see automation/paths.yaml)",
          email,
        });
      case "not_found":
        return withCors(NextResponse.json({ success: true, data: null, email }));
      case "found":
        return withCors(NextResponse.json({ success: true, data: result.data, email }));
      default:
        return corsErrorJson(500, { success: false, error: "Unknown error", email });
    }
  } catch (error) {
    // Most often a rejected Google Sheets API call: bad credentials, the
    // service account lacks access to the sheet, or the sheet/tab was renamed.
    return corsErrorJson(500, {
      success: false,
      error: error instanceof Error ? error.message : "Failed to read from Google Sheets",
      email,
    });
  }
}
