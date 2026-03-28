import dotenv from "dotenv";
import mongoose from "mongoose";

import AdminInvitation from "./database/models/adminInvitation.model.js";
import { buildInvitationCodePreview, hashToken } from "./service/adminAuth.service.js";

dotenv.config();

const mongoUri = String(process.env.MONGO_URI || "").trim();

if (!mongoUri) {
    throw new Error("MONGO_URI is required");
}

const markExpiredPendingInvitations = async () =>
    AdminInvitation.updateMany(
        {
            status: "PENDING",
            expiresAt: { $lte: new Date() }
        },
        {
            $set: {
                status: "EXPIRED"
            }
        }
    );

const backfillLegacyInvitations = async () => {
    const legacyInvitations = await AdminInvitation.find({
        invitationCode: { $exists: true, $type: "string", $ne: "" },
        $or: [
            { invitationCodeHash: { $exists: false } },
            { invitationCodePreview: { $exists: false } }
        ]
    }).select("_id invitationCode invitationCodeHash invitationCodePreview");

    let updated = 0;
    for (const invitation of legacyInvitations) {
        const legacyCode = String(invitation.invitationCode || "").trim();
        if (!legacyCode) {
            continue;
        }

        invitation.invitationCodeHash = invitation.invitationCodeHash || hashToken(legacyCode);
        invitation.invitationCodePreview =
            invitation.invitationCodePreview || buildInvitationCodePreview(legacyCode);
        await invitation.save();
        updated += 1;
    }

    return updated;
};

const dropLegacyExpiryTtlIndexes = async () => {
    const indexes = await AdminInvitation.collection.indexes();
    const ttlIndexes = indexes.filter((index) =>
        index.key?.expiresAt === 1 && Object.prototype.hasOwnProperty.call(index, "expireAfterSeconds")
    );

    for (const index of ttlIndexes) {
        await AdminInvitation.collection.dropIndex(index.name);
    }

    return ttlIndexes.map((index) => index.name);
};

async function main() {
    await mongoose.connect(mongoUri);

    const droppedIndexes = await dropLegacyExpiryTtlIndexes();
    const expiredResult = await markExpiredPendingInvitations();
    const backfilledCount = await backfillLegacyInvitations();

    console.log("Admin invitation migration complete");
    console.log(`Dropped TTL indexes: ${droppedIndexes.length ? droppedIndexes.join(", ") : "none"}`);
    console.log(`Expired pending invitations marked: ${expiredResult.modifiedCount || 0}`);
    console.log(`Legacy invitations backfilled: ${backfilledCount}`);
}

main()
    .catch((error) => {
        console.error(`Admin invitation migration failed: ${error.message}`);
        process.exitCode = 1;
    })
    .finally(async () => {
        if (mongoose.connection.readyState !== 0) {
            await mongoose.disconnect();
        }
    });
