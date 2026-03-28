// helper script used during development to sign partner webhook payloads
// **DO NOT** commit real secrets to source control; this file should not be used in production.

import crypto from 'crypto';

const apiSecret = process.env.PARTNER_API_SECRET;
if (!apiSecret) {
    console.error('PARTNER_API_SECRET must be set in environment to run this script.');
    process.exit(1);
}

const timestamp = Date.now();

const body = {
    eventId: 'BETCO-001',
    phone: '+254700000000',
    amount: 2000
};

const payload = `${timestamp}POST/api/v1/partners/events${JSON.stringify(body)}`;

const signature = crypto
    .createHmac('sha256', apiSecret)
    .update(payload)
    .digest('hex');

console.log(signature, timestamp);
