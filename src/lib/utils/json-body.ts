import { NextResponse } from "next/server";

/**
 * Read a POST body that must be a JSON object.
 *
 * `request.json()` happily returns `null`, a number, a string or an array for a
 * body that is valid JSON but not an object, and every stats route then
 * destructured it — `const { episodeId } = null` throws a TypeError, so a body
 * of `null` was an unhandled 500 on all five POST routes instead of a 400.
 *
 * Returns the object, or a 400 response to send as-is.
 */
export async function readJsonObject(
  request: Request,
): Promise<{ body: Record<string, unknown>; error?: never } | { body?: never; error: NextResponse }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { error: NextResponse.json({ error: "Invalid JSON" }, { status: 400 }) };
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { error: NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 }) };
  }
  return { body: body as Record<string, unknown> };
}
