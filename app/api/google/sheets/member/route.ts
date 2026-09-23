import "server-only";
import { NextResponse } from "next/server";
import { corsErrorJson, corsPreflight, withCors } from "@/lib/cors";
import { saveMemberData } from "@/lib/google/sheets-member";

export const runtime = "nodejs";

// Node's counterpart to team's Rust /api/google/sheets/member (save_member_data)
// — unlike Rust's stub, this actually appends/updates a row in the sheet.
export async function OPTIONS() {
  return corsPreflight();
}

type SaveMemberRequestBody = {
  data?: Record<string, string>;
  email?: string;
  updateExisting?: boolean;
};

async function handleSave(request: Request) {
  try {
    const body = (await request.json()) as SaveMemberRequestBody;
    const { data, email, updateExisting } = body;

    if (!email) {
      return corsErrorJson(400, { success: false, error: "email is required" });
    }

    const result = await saveMemberData(data ?? {}, email, !!updateExisting);

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
      case "saved":
        return withCors(NextResponse.json({ success: true, data: result.data, updated: result.updated }));
      default:
        return corsErrorJson(500, { success: false, error: "Unknown error", email });
    }
  } catch (error) {
    // Malformed JSON body, or a rejected Google Sheets API call: bad
    // credentials, the service account lacks write access, quota, etc.
    return corsErrorJson(500, {
      success: false,
      error: error instanceof Error ? error.message : "Failed to save to Google Sheets",
    });
  }
}

export async function POST(request: Request) {
  return handleSave(request);
}

export async function PUT(request: Request) {
  return handleSave(request);
}
