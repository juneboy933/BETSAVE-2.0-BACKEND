import crypto from "crypto";

const apiSecret = "42cc5681965b70b46aa5abb9358c58cbaa0c96152435c2c817bc05140843b2d0";

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
