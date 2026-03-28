import crypto from "crypto";

const apiSecret = process.env.PARTNER_API_SECRET;
if (!apiSecret) {
  console.error("PARTNER_API_SECRET must be set in environment to run this script.");
  process.exit(1);
}

const timestamp = Date.now().toString();

// CHANGE PATH BASED ON ENDPOINT
// const path = "/api/v1/dashboard/events";
const path = "/api/v1/dashboard/analytics";

const body = {}; // GET request still uses empty object

const payload = `${timestamp}GET${path}${JSON.stringify(body)}`;

const signature = crypto
  .createHmac("sha256", apiSecret)
  .update(payload)
  .digest("hex");

console.log({
  timestamp,
  signature
});
