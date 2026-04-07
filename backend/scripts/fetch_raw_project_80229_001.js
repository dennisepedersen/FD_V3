/**
 * Read-only script: fetch raw JSON for project ref 80229-001 from EK v4 and v3.
 * No mapping, no transformation, no filtering.
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env.production") });

const crypto = require("crypto");
const { Pool } = require("pg");

const TARGET_REF = "80229-001";
const PAGE_SIZE = 200;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function encryptionKey() {
  return crypto.createHash("sha256").update(process.env.JWT_SECRET).digest();
}

function decryptSecret(cipherText) {
  const [ivBase64, tagBase64, encryptedBase64] = String(cipherText || "").split(".");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivBase64, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagBase64, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedBase64, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

function normalizeBase(baseUrl) {
  const parsed = new URL(String(baseUrl || "").trim());
  const cleanPath = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${cleanPath}`;
}

async function fetchJson(url, headers) {
  const response = await fetch(url, { method: "GET", headers });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText} from ${url}`);
  }
  return response.json();
}

function extractDateFields(obj) {
  const DATE_KEYS = [
    "startDate","StartDate","endDate","EndDate",
    "updatedDate","UpdatedDate","createdDate","CreatedDate",
    "lastRegistration","LastRegistration","lastFitterHourDate","LastFitterHourDate",
    "lastModifiedDate","LastModifiedDate","changedDate","ChangedDate",
    "closedDate","ClosedDate","deliveryDate","DeliveryDate",
    "offerDate","OfferDate","orderDate","OrderDate",
  ];
  const found = {};
  for (const key of DATE_KEYS) {
    if (obj[key] !== undefined) {
      found[key] = obj[key];
    }
  }
  return found;
}

async function fetchDirect(url, headers) {
  const response = await fetch(url, { method: "GET", headers });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status} ${response.statusText} - ${body.slice(0, 200)}`);
  }
  return response.json();
}

async function searchPaged(endpointBase, headers, label) {
  let page = 1;
  while (true) {
    const url = `${endpointBase}?page=${page}&pageSize=${PAGE_SIZE}`;
    let payload;
    try {
      payload = await fetchJson(url, headers);
    } catch (err) {
      return { found: false, error: err.message, endpoint: endpointBase, testedPages: page };
    }

    // EK returns array or { data/items/projects + nextPage }
    const items = Array.isArray(payload)
      ? payload
      : (payload.data || payload.items || payload.projects || payload.result || []);

    const match = items.find((p) => {
      const ref = p.projectNumber || p.ProjectNumber || p.reference || p.Reference ||
                  p.projectRef || p.ProjectRef || p.number || p.Number;
      return String(ref || "").trim() === TARGET_REF;
    });

    if (match) {
      return {
        found: true,
        endpoint: endpointBase,
        page,
        raw: match,
        dateFields: extractDateFields(match),
      };
    }

    const nextPage = payload.nextPage ?? payload.NextPage ?? null;
    const total = payload.pageCount ?? payload.totalPages ?? null;

    if (nextPage == null || nextPage === false || nextPage === 0) break;
    if (total != null && page >= total) break;

    page = typeof nextPage === "number" ? nextPage : page + 1;
    if (page > 300) break; // safety

    // Small delay to avoid 429
    await new Promise((r) => setTimeout(r, 300));
  }

  return { found: false, endpoint: endpointBase, testedPages: page };
}

async function main() {
  const client = await pool.connect();
  let ekBaseUrl, ekApiKey;

  try {
    const { rows } = await client.query(
      `SELECT tc.ek_base_url, tc.ek_api_key_encrypted
       FROM tenant_config tc
       JOIN tenant t ON t.id = tc.tenant_id
       WHERE t.slug = 'hoyrup-clemmensen'
       LIMIT 1`
    );
    if (!rows[0]) throw new Error("No tenant config found for hoyrup-clemmensen");
    ekBaseUrl = rows[0].ek_base_url;
    ekApiKey = decryptSecret(rows[0].ek_api_key_encrypted);
  } finally {
    client.release();
  }

  const base = normalizeBase(ekBaseUrl);

  // Also fetch siteName from config_snapshot
  const client2 = await pool.connect();
  let siteName = "Ekstern";
  try {
    const { rows: snapshotRows } = await client2.query(
      `SELECT config_snapshot FROM tenant_config_snapshot
       WHERE tenant_id = (SELECT id FROM tenant WHERE slug = 'hoyrup-clemmensen')
       ORDER BY changed_at DESC LIMIT 1`
    );
    const snap = snapshotRows[0]?.config_snapshot || {};
    if (snap.ek_site_name && String(snap.ek_site_name).trim()) {
      siteName = String(snap.ek_site_name).trim();
    }
  } finally {
    client2.release();
  }
  await pool.end();

  console.log(`siteName: ${siteName}`);

  const headers = {
    apikey: ekApiKey,
    siteName: siteName,
    Accept: "application/json",
  };

  const encodedRef = encodeURIComponent(TARGET_REF);

  console.log(`\nEK base URL: ${base}`);
  console.log(`Searching for project ref: ${TARGET_REF}\n`);
  console.log("=".repeat(60));

  // --- V4: try direct ref lookup, fallback to paged scan ---
  const v4DirectEndpoints = [
    `${base}/api/v4.0/projects/ref/${encodedRef}`,
    `${base}/api/v4/projects/ref/${encodedRef}`,
  ];

  console.log("\n[V4] Trying direct ref lookup...");
  let v4Result = null;
  for (const url of v4DirectEndpoints) {
    try {
      const raw = await fetchDirect(url, headers);
      v4Result = { found: true, endpoint: url, page: "direct", raw, dateFields: extractDateFields(raw) };
      break;
    } catch (err) {
      console.log(`  ${url} -> ${err.message.split(" - ")[0]}`);
    }
  }

  if (!v4Result) {
    console.log("[V4] Direct lookup failed, falling back to paged scan...");
    // 5 second wait before paging to let 429 cool off
    await new Promise((r) => setTimeout(r, 5000));
    v4Result = await searchPaged(`${base}/api/v4.0/projects`, headers, "V4");
  }

  console.log("\n--- V4 RESULT ---");
  if (v4Result.found) {
    console.log(`endpoint: ${v4Result.endpoint}`);
    console.log(`page:     ${v4Result.page}`);
    console.log("\nraw JSON:");
    console.log(JSON.stringify(v4Result.raw, null, 2));
    console.log("\nDate fields:");
    console.log(JSON.stringify(v4Result.dateFields, null, 2));
  } else if (v4Result.error) {
    console.log(`ERROR: ${v4Result.error}`);
  } else {
    console.log(`NOT FOUND (scanned ${v4Result.testedPages} page(s))`);
  }

  // Wait before v3 to avoid rate limiting
  console.log("\nWaiting 25s before V3 calls to avoid rate limiting...");
  await new Promise((r) => setTimeout(r, 25000));

  // --- V3: try WorkInProgress direct, then fallback ---
  console.log("\n[V3] Trying direct ref lookup on WorkInProgress...");
  const v3DirectEndpoints = [
    `${base}/Management/WorkInProgress?projectNumber=${encodedRef}`,
    `${base}/api/v3.0/projects/ref/${encodedRef}`,
    `${base}/api/v3/projects/ref/${encodedRef}`,
  ];

  let v3Result = null;
  for (const url of v3DirectEndpoints) {
    try {
      const raw = await fetchDirect(url, headers);
      // WorkInProgress with filter might return array
      if (Array.isArray(raw)) {
        const match = raw.find((p) => {
          const n = p.projectNumber || p.ProjectNumber || p.number || p.Number;
          return String(n || "").trim() === TARGET_REF;
        });
        if (match) {
          v3Result = { found: true, endpoint: url, page: "direct/filtered", raw: match, dateFields: extractDateFields(match) };
          break;
        }
        console.log(`  ${url.split("?")[0]} -> returned array(${raw.length}), ref not found`);
      } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        // Could be paged result
        const items = raw.data || raw.items || raw.projects || raw.result || [];
        if (items.length > 0) {
          const match = items.find((p) => {
            const n = p.projectNumber || p.ProjectNumber || p.number || p.Number;
            return String(n || "").trim() === TARGET_REF;
          });
          if (match) {
            v3Result = { found: true, endpoint: url, page: "direct/filtered", raw: match, dateFields: extractDateFields(match) };
            break;
          }
        } else {
          // Single object response
          v3Result = { found: true, endpoint: url, page: "direct", raw, dateFields: extractDateFields(raw) };
          break;
        }
        console.log(`  ${url.split("?")[0]} -> no match`);
      }
    } catch (err) {
      console.log(`  ${url.split("?")[0]} -> ${err.message.split(" - ")[0]}`);
    }
  }

  if (!v3Result) {
    console.log("[V3] Direct lookup failed, falling back to paged scan of WorkInProgress...");
    await new Promise((r) => setTimeout(r, 5000));
    v3Result = await searchPaged(`${base}/Management/WorkInProgress`, headers, "V3");
  }

  console.log("\n--- V3 RESULT ---");
  if (v3Result && v3Result.found) {
    console.log(`endpoint: ${v3Result.endpoint}`);
    console.log(`page:     ${v3Result.page}`);
    console.log("\nraw JSON:");
    console.log(JSON.stringify(v3Result.raw, null, 2));
    console.log("\nDate fields:");
    console.log(JSON.stringify(v3Result.dateFields, null, 2));
  } else if (v3Result && v3Result.error) {
    console.log(`ERROR: ${v3Result.error}`);
  } else {
    console.log(`NOT FOUND (scanned ${v3Result?.testedPages ?? "?"} page(s))`);
  }

  console.log("\n" + "=".repeat(60));
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
