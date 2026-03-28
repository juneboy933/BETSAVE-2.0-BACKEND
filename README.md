# BETSAVE 2.0 Backend

This backend helps betting partners convert betting activity into savings activity for linked users.

At a high level:

1. A partner registers and gets API credentials.
2. The partner links a user phone number to that partner.
3. The user verifies OTP.
4. The partner posts a `BET_PLACED` event.
5. BETSAVE computes the savings amount.
6. BETSAVE triggers an STK push to collect the savings amount.
7. Daraja calls BETSAVE back.
8. BETSAVE finalizes the event and sends the result to the partner webhook.

If you only want the fastest way to integrate, jump to `Partner Quickstart`.

## What This System Actually Is

This is not just a CRUD API.

It is a small event-driven financial workflow with:

- `Express` for the HTTP API
- `MongoDB` for users, events, wallets, transactions, partner records, and logs
- `Redis + BullMQ` for background processing
- `Daraja` for STK collection and B2C disbursement
- partner webhooks for asynchronous final results

There are 4 moving parts you need to understand:

### 1. API server

The API server accepts requests, validates env vars, connects to MongoDB, exposes health routes, and mounts all HTTP routes.

Main entry:

- [Backend/app/server.js](/c:/Users/Brian/Desktop/BETSAVE-2.0-BACKEND/Backend/app/server.js)

### 2. Event worker

This worker picks accepted partner events from Redis, calculates the savings amount, creates the deposit transaction, and initiates the STK push.

Main files:

- [Backend/worker/event.worker.js](/c:/Users/Brian/Desktop/BETSAVE-2.0-BACKEND/Backend/worker/event.worker.js)
- [Backend/service/processEvent.service.js](/c:/Users/Brian/Desktop/BETSAVE-2.0-BACKEND/Backend/service/processEvent.service.js)

### 3. Webhook worker

This worker sends final event results to the partner webhook URL after the payment flow settles.

Main files:

- [Backend/worker/webhook.worker.js](/c:/Users/Brian/Desktop/BETSAVE-2.0-BACKEND/Backend/worker/webhook.worker.js)
- [Backend/service/notifyPartner.service.js](/c:/Users/Brian/Desktop/BETSAVE-2.0-BACKEND/Backend/service/notifyPartner.service.js)

### 4. Recovery worker

This worker looks for stuck events and stale transactions and tries to mark them correctly.

Main files:

- [Backend/worker/recovery.worker.js](/c:/Users/Brian/Desktop/BETSAVE-2.0-BACKEND/Backend/worker/recovery.worker.js)
- [Backend/service/operationalRecovery.service.js](/c:/Users/Brian/Desktop/BETSAVE-2.0-BACKEND/Backend/service/operationalRecovery.service.js)

## Core Concepts

### Partner

A company integrating with BETSAVE.

Partners have:

- dashboard login credentials
- an `apiKey`
- an `apiSecret`
- an optional webhook URL
- an operating mode: `demo` or `live`

### Partner user

A user linked to a specific partner. This link matters because savings are attributed to that partner.

### Event

Right now the important event is:

- `BET_PLACED`

An event is accepted, queued, processed, and eventually finalized as either:

- `PROCESSED`
- `FAILED`

### Payment transaction

This tracks deposits and withdrawals.

### Operating mode

- `demo`: easier testing, fewer live restrictions
- `live`: stricter write controls and production expectations

## How The Flow Works

### Partner onboarding flow

1. Partner registers at `POST /api/v1/partners/auth/register`
2. BETSAVE creates:
   partner record
   partner auth record
3. BETSAVE returns:
   `apiKey`
   `apiSecret`
4. Partner stores both on their own backend

Relevant files:

- [Backend/app/controller/partnerAuth.controller.js](/c:/Users/Brian/Desktop/BETSAVE-2.0-BACKEND/Backend/app/controller/partnerAuth.controller.js)
- [Backend/service/partnerAuth.service.js](/c:/Users/Brian/Desktop/BETSAVE-2.0-BACKEND/Backend/service/partnerAuth.service.js)

### User linking flow

1. Partner sends phone number to `POST /api/v1/partners/users/register`
2. BETSAVE creates or reuses the user
3. BETSAVE creates or updates the partner-user link
4. OTP is triggered if the user is not yet verified
5. Partner confirms OTP via `POST /api/v1/partners/users/verify-otp`

Relevant files:

- [Backend/app/controller/partner.controller.js](/c:/Users/Brian/Desktop/BETSAVE-2.0-BACKEND/Backend/app/controller/partner.controller.js)
- [Backend/service/registerPartnerUser.service.js](/c:/Users/Brian/Desktop/BETSAVE-2.0-BACKEND/Backend/service/registerPartnerUser.service.js)

### Event-to-savings flow

1. Partner posts `BET_PLACED` to `POST /api/v1/partners/events`
2. BETSAVE validates:
   partner exists
   user exists
   user is verified
   user is linked to this partner
   auto-savings is enabled
3. BETSAVE records an `Event` with status `RECEIVED`
4. BETSAVE pushes a job to Redis
5. Event worker pulls the job
6. Savings amount is computed from `SAVINGS_PERCENTAGE`
7. BETSAVE creates a deposit transaction
8. BETSAVE calls Daraja STK
9. Daraja calls BETSAVE callback URL
10. BETSAVE confirms or fails the payment transaction
11. BETSAVE finalizes the event
12. Webhook worker sends the final status to the partner webhook

Relevant files:

- [Backend/app/controller/event.controller.js](/c:/Users/Brian/Desktop/BETSAVE-2.0-BACKEND/Backend/app/controller/event.controller.js)
- [Backend/service/ingestEvent.service.js](/c:/Users/Brian/Desktop/BETSAVE-2.0-BACKEND/Backend/service/ingestEvent.service.js)
- [Backend/service/processEvent.service.js](/c:/Users/Brian/Desktop/BETSAVE-2.0-BACKEND/Backend/service/processEvent.service.js)
- [Backend/service/eventFinalization.service.js](/c:/Users/Brian/Desktop/BETSAVE-2.0-BACKEND/Backend/service/eventFinalization.service.js)

### Withdrawal flow

Withdrawals can be created by:

- the user
- a partner on behalf of a linked user

Relevant files:

- [Backend/app/controller/payment.controller.js](/c:/Users/Brian/Desktop/BETSAVE-2.0-BACKEND/Backend/app/controller/payment.controller.js)
- [Backend/service/paymentWithdrawal.service.js](/c:/Users/Brian/Desktop/BETSAVE-2.0-BACKEND/Backend/service/paymentWithdrawal.service.js)
- [Backend/service/withdrawalEligibility.service.js](/c:/Users/Brian/Desktop/BETSAVE-2.0-BACKEND/Backend/service/withdrawalEligibility.service.js)

## Partner Quickstart

This is the simplest sensible integration path.

### Step 1. Register partner

Request:

```http
POST /api/v1/partners/auth/register
Content-Type: application/json

{
  "name": "BetCo",
  "email": "ops@betco.com",
  "password": "a-strong-password",
  "webhookUrl": "https://partner.example.com/betsave/webhook",
  "operatingMode": "demo"
}
```

Save these immediately:

- `apiKey`
- `apiSecret`

Do not put them in frontend code.

### Step 2. Link a user

Request:

```http
POST /api/v1/partners/users/register
```

Body:

```json
{
  "phone": "+254700000000",
  "autoSavingsEnabled": true
}
```

### Step 3. Verify OTP

Request:

```http
POST /api/v1/partners/users/verify-otp
```

Body:

```json
{
  "phone": "+254700000000",
  "otp": "1234"
}
```

### Step 4. Post a bet event

Request:

```http
POST /api/v1/partners/events
```

Body:

```json
{
  "eventId": "BET-12345",
  "phone": "+254700000000",
  "amount": 2000,
  "type": "BET_PLACED"
}
```

### Step 5. Wait for webhook

You should not treat `POST /api/v1/partners/events` as the final success.

It only tells you the event was accepted for processing.

The final truth arrives via your webhook.

Example successful webhook payload:

```json
{
  "eventId": "BET-12345",
  "status": "PROCESSED",
  "savingsAmount": 200,
  "paymentStatus": "SUCCESS",
  "paymentTransactionId": "..."
}
```

Example failed webhook payload:

```json
{
  "eventId": "BET-12345",
  "status": "FAILED",
  "reason": "User not linked to this partner"
}
```

## How Partner Authentication Works

There are 2 authentication styles in this codebase.

### 1. Dashboard session auth

This is for human operators using the partner dashboard.

Do not build your production backend integration around dashboard tokens.

### 2. Signed server-to-server auth

This is the correct integration path for partner backend systems.

Protected partner write routes expect:

- `x-api-key`
- `x-signature`
- `x-timestamp`

In `live` mode they also expect:

- `x-integration-token`

Relevant middleware:

- [Backend/app/middleware/partnerAuth.middleware.js](/c:/Users/Brian/Desktop/BETSAVE-2.0-BACKEND/Backend/app/middleware/partnerAuth.middleware.js)
- [Backend/app/middleware/partnerMode.middleware.js](/c:/Users/Brian/Desktop/BETSAVE-2.0-BACKEND/Backend/app/middleware/partnerMode.middleware.js)

### Signature algorithm

The backend computes:

```text
${timestamp}${HTTP_METHOD}${path}${JSON.stringify(body)}
```

Then signs it with:

```text
HMAC-SHA256(apiSecret)
```

Important:

- the path must match exactly
- the method must be uppercase
- the JSON body must match exactly
- GET requests still use `{}`
- timestamps expire after 5 minutes

Example Node.js signing code:

```js
import crypto from "crypto";

const apiSecret = process.env.BETSAVE_API_SECRET;
const timestamp = Date.now().toString();
const method = "POST";
const path = "/api/v1/partners/events";
const body = {
  eventId: "BET-12345",
  phone: "+254700000000",
  amount: 2000,
  type: "BET_PLACED"
};

const payload = `${timestamp}${method}${path}${JSON.stringify(body)}`;
const signature = crypto
  .createHmac("sha256", apiSecret)
  .update(payload)
  .digest("hex");
```

Then send:

```http
x-api-key: <apiKey>
x-timestamp: <timestamp>
x-signature: <signature>
```

## Minimal Integration Contract

If I were mentoring a partner team, I would tell them to support exactly this and no more on day one:

1. Register partner and store credentials safely.
2. Expose one HTTPS webhook endpoint on your side.
3. Register users by phone.
4. Verify OTP.
5. Post `BET_PLACED` events.
6. Persist `eventId` and treat it as your idempotency key.
7. Wait for BETSAVE webhook before marking savings as completed in your own system.

That is the simplest path with the lowest chance of operational nonsense.

## Important Endpoints

### Health

- `GET /`
- `GET /health`

### Partner auth

- `POST /api/v1/partners/auth/register`
- `POST /api/v1/partners/auth/login`
- `POST /api/v1/partners/auth/refresh`
- `POST /api/v1/partners/auth/logout`

Partner auth responses also return a `token` so the frontend can use `Authorization: Bearer <token>` when cookie-based auth is inconvenient across origins.

### Partner integration

- `GET /api/v1/partners/mode`
- `PATCH /api/v1/partners/mode`
- `POST /api/v1/partners/users/register`
- `POST /api/v1/partners/users/verify-otp`
- `POST /api/v1/partners/events`
- `POST /api/v1/partners/users/:userId/withdrawals`

### User payments

- `POST /api/v1/payments/:userId/deposits`
- `POST /api/v1/payments/:userId/withdrawals`
- `GET /api/v1/payments/:userId/transactions`
- `GET /api/v1/payments/:userId/transactions/:paymentTransactionId`

## Frontend Compatibility

This backend can support both the Partner and Admin frontends from the BETSAVE 2.0 frontend repo.

The important deployment setting is `CORS_ALLOWED_ORIGINS`, which should include both frontend origins as a comma-separated list.

Example:

```env
CORS_ALLOWED_ORIGINS=https://partner.example.com,https://admin.example.com
```

For cross-origin deployments, prefer header-based auth instead of depending purely on browser cookies:

- Partner frontend: use the `token` returned by partner auth endpoints as `Authorization: Bearer <token>`
- Admin frontend: use the `token` returned by admin auth endpoints as `x-admin-token: <token>`

Cookie auth is still supported, but header auth is simpler and more predictable when the API and frontends are on different origins.

### Daraja callbacks

- `POST /api/v1/payments/callbacks/deposit`
- `POST /api/v1/payments/callbacks/withdrawal`
- `POST /api/v1/payments/callbacks/b2c/queue`
- `POST /api/v1/payments/callbacks/b2c/result`

## Required Infrastructure

You need all of these in a real deployment:

- Node.js service for the API
- MongoDB
- Redis
- event worker
- webhook worker
- recovery worker

If you only deploy the API and skip the workers, the system is not really deployed.

That is not optional.

## Environment Variables You Actually Care About

Use [Backend/.env.example](/c:/Users/Brian/Desktop/BETSAVE-2.0-BACKEND/Backend/.env.example) as the source of truth.

The big ones:

- `PORT`
- `MONGO_URI`
- `REDIS_URI`
- `PARTNER_JWT_SECRET`
- `PARTNER_SECRET_ENCRYPTION_KEY`
- `USER_JWT_SECRET`
- `CORS_ALLOWED_ORIGINS`
- `PAYMENT_CALLBACK_TOKEN`
- `DARAJA_*`
- `PARTNER_INTEGRATION_TOKEN`

For your Render deployment, the public callback URLs should use your deployed backend domain:

- `DARAJA_STK_CALLBACK_URL=https://betsave-2-0-backend.onrender.com/api/v1/payments/callbacks/deposit`
- `DARAJA_B2C_TIMEOUT_URL=https://betsave-2-0-backend.onrender.com/api/v1/payments/callbacks/b2c/queue`
- `DARAJA_B2C_RESULT_URL=https://betsave-2-0-backend.onrender.com/api/v1/payments/callbacks/b2c/result`

## Hard Truths

This is the ruthless mentor section.

### 1. The codebase has two partner auth stories

There is a newer partner auth flow and an older controller/service flow still in the repo.

The older flow:

- [Backend/app/controller/partner.controller.js](/c:/Users/Brian/Desktop/BETSAVE-2.0-BACKEND/Backend/app/controller/partner.controller.js)
- [Backend/service/registerPartner.service.js](/c:/Users/Brian/Desktop/BETSAVE-2.0-BACKEND/Backend/service/registerPartner.service.js)

That older path stores `apiSecret` in plaintext on the partner model.

That is a bad pattern.

The newer auth path encrypts partner secrets and is the one you should keep investing in.

### 2. Dead code is starting to compete with real code

There are helper scripts and legacy controller paths that make the system harder to reason about.

If you do not prune them, future developers will integrate the wrong thing.

### 3. A global live integration token is too coarse

`PARTNER_INTEGRATION_TOKEN` is global, not per partner.

That means one shared secret is protecting live write actions across the whole platform.

That is workable for an early system, but not a mature multi-partner production architecture.

### 4. The system is async, so pretending it is sync will hurt you

Posting an event is not the same as completing a savings transaction.

If a partner treats `POST /api/v1/partners/events` as final success, they are integrating incorrectly.

### 5. Workers are first-class runtime components

If workers are down, the system is partially down.

Stop talking about only the API service. That is not the full system.

## Recommended Cleanup Roadmap

If I were leading this codebase, I would do this next:

1. Delete or quarantine the legacy plaintext-secret partner flow.
2. Add a single official partner integration spec and keep it versioned.
3. Move shared signature code into one small official SDK or example client.
4. Split dashboard concerns from integration concerns more aggressively.
5. Add deployment docs for API service plus all workers.
6. Add an integration test suite that covers:
   partner register
   user link
   OTP verify
   event post
   callback finalize
   webhook delivery

## Local Development

Install dependencies:

```bash
cd Backend
npm install
```

Run API:

```bash
npm start
```

Run workers in separate terminals:

```bash
npm run worker:event
npm run worker:webhook
npm run worker:recovery
```

## Final Advice To Partner Teams

Do not integrate from the browser.

Do not expose the `apiSecret`.

Do not skip webhook handling.

Do not go live before:

- your webhook is HTTPS
- your callback URLs are correct
- your workers are running
- your idempotency strategy is real
- your ops team can read the logs

The simplest good integration is small, server-to-server, signed, idempotent, and webhook-driven.
