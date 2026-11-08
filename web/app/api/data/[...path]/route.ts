// Weiterleitung zu den Website-Dateien in R2 (Ordner public/). Der Bucket bleibt privat:
// Der Lese-Schlüssel liegt nur bei Vercel, und erreichbar sind nur die erlaubten Dateien unten.
// Lokal zum Testen: DATA_DIR=/pfad/zu/daten (enthält public/…) statt R2-Zugangsdaten.
import { AwsClient } from "aws4fetch";
import { readFile } from "node:fs/promises";
import path from "node:path";

const ALLOWED = /^[a-z0-9-]+\/(status|catalog|spark|index)\.json$|^[a-z0-9-]+\/products\/\d+\.json$/;

let client: AwsClient | null = null;
function r2(): AwsClient {
  client ??= new AwsClient({
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
    service: "s3",
    region: "auto",
  });
  return client;
}

function cacheHeader(file: string, versioned: boolean): string {
  // status.json ist klein und zeigt, ob es neue Daten gibt -> kurz cachen.
  if (file.endsWith("status.json")) return "public, max-age=60, s-maxage=300, stale-while-revalidate=3600";
  // Alle anderen Dateien werden mit ?v=<version aus status.json> abgerufen -> neue Version = neue Adresse.
  return versioned
    ? "public, max-age=86400, s-maxage=31536000, immutable"
    : "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";
}

export async function GET(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await ctx.params;
  const rel = parts.join("/");
  if (!ALLOWED.test(rel)) return Response.json({ error: "not found" }, { status: 404 });
  const versioned = new URL(request.url).searchParams.has("v");

  let body: string | null = null;
  try {
    if (process.env.DATA_DIR) {
      body = await readFile(path.join(process.env.DATA_DIR, "public", rel), "utf-8");
    } else {
      const { R2_ACCOUNT_ID, R2_BUCKET } = process.env;
      if (!R2_ACCOUNT_ID || !R2_BUCKET) {
        return Response.json({ error: "R2 is not configured (R2_ACCOUNT_ID, R2_BUCKET, keys)." }, { status: 500 });
      }
      const res = await r2().fetch(`https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/public/${rel}`);
      if (res.status === 404) return Response.json({ error: "not found" }, { status: 404 });
      if (!res.ok) return Response.json({ error: `storage responded ${res.status}` }, { status: 502 });
      body = await res.text();
    }
  } catch {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  return new Response(body, {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": cacheHeader(rel, versioned) },
  });
}
