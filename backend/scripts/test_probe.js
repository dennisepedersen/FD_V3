const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env.production") });

// Test the probe logic directly
async function testProbe() {
  console.log("Testing probe logic...");
  
  const endpoint = "https://externalaccessapi.e-komplet.dk/api/v4.0/projects";
  const apiKey = process.env.EK_API_KEY_ENCRYPTED;
  
  if (!apiKey) {
    console.error("No EK_API_KEY_ENCRYPTED in env");
    return;
  }
  
  // Decrypt if needed
  const crypto = require("crypto");
  const jwt = require("jsonwebtoken");
  const secret = process.env.JWT_SECRET;
  
  function encryptionKey() {
    return crypto.createHash("sha256").update(secret).digest();
  }
  
  function decryptSecret(cipherText) {
    const [ivBase64, tagBase64, encryptedBase64] = String(cipherText || "").split(".");
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivBase64, "base64"));
    decipher.setAuthTag(Buffer.from(tagBase64, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedBase64, "base64")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  }
  
  const ekApiKey = decryptSecret(apiKey);
  const headers = {
    "Authorization": `Bearer ${ekApiKey}`,
    "Content-Type": "application/json",
  };
  
  console.log(`Probing ${endpoint}?page=1&pageSize=1`);
  
  try {
    const response = await fetch(`${endpoint}?page=1&pageSize=1`, { method: "GET", headers });
    console.log(`Response status: ${response.status}`);
    
    if (response.status === 429) {
      console.log("✓ Got 429 - this proves endpoint exists but is rate-limited");
      console.log("✓ With the patch, 429 should be treated as 'compatible'");
    } else if (response.ok) {
      console.log("✓ Got 200 - endpoint is accessible");
    } else {
      console.log(`Got ${response.status} - probe logic should handle this`);
    }
  } catch (err) {
    console.error(`Fetch error: ${err.message}`);
  }
}

testProbe().catch(console.error);
