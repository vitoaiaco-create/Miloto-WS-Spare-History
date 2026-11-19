import "server-only"

import { auth } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"

// Thrown by `requireAdmin`; `status` lets Route Handlers answer with the
// right HTTP code (401 signed out, 403 signed in without the admin role).
export class HrAuthError extends Error {
  readonly status: 401 | 403

  constructor(message: "Unauthorized" | "Forbidden", status: 401 | 403) {
    super(message)
    this.name = "HrAuthError"
    this.status = status
  }
}

// Verifies a Clerk session with the admin role (matches the page-level gate
// and `generateDisciplinaryData`). Single source of truth for the HR Server
// Actions (src/actions/hr-cases.ts) and the attachment Route Handlers
// (src/app/api/hr/**). Throws `HrAuthError`; callers convert it to a plain
// error result or an HTTP response.
export async function requireAdmin() {
  const { userId, sessionClaims } = await auth()
  if (!userId) throw new HrAuthError("Unauthorized", 401)
  if (sessionClaims?.metadata?.role !== "admin") {
    throw new HrAuthError("Forbidden", 403)
  }
  return userId
}

// Route Handler helper: runs `requireAdmin` and returns the 401 / 403
// response to send when it fails, or `null` when the caller is an admin.
export async function adminGuard(): Promise<NextResponse | null> {
  try {
    await requireAdmin()
    return null
  } catch (error) {
    if (error instanceof HrAuthError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: error.status }
      )
    }
    throw error
  }
}
