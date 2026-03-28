import PartnerUser from "../database/models/partnerUser.model.js";
import User from "../database/models/user.model.js";
import Wallet from "../database/models/wallet.model.js";
import { runRequiredTransaction } from "./databaseSession.service.js";

const KENYA_PHONE_REGEX = /^\+254\d{9}$/;

export const registerPartnerUser = async ({ partner, phone, autoSavingsEnabled }) => {
    const normalizedPhone = phone?.trim();
    if (!normalizedPhone || !KENYA_PHONE_REGEX.test(normalizedPhone)) {
        throw new Error("Invalid phone number");
    }

    try {
        const result = await runRequiredTransaction(async (session) => {
            const createOptions = session ? { session } : undefined;
            let userQuery = User.findOne({ phoneNumber: normalizedPhone });
            if (session) {
                userQuery = userQuery.session(session);
            }

            let user = await userQuery;
            let createdNewUser = false;

            if (!user) {
                const createdUsers = await User.create([{ phoneNumber: normalizedPhone }], createOptions);
                user = createdUsers[0];
                createdNewUser = true;

                await Wallet.create(
                    [{
                        userId: user._id,
                        balance: 0,
                        lastProcessedLedgerId: null
                    }],
                    createOptions
                );
            }

            let existingPartnerUserQuery = PartnerUser.findOne({ partnerId: partner.id, userId: user._id });
            if (session) {
                existingPartnerUserQuery = existingPartnerUserQuery.session(session);
            }
            const existingPartnerUser = await existingPartnerUserQuery;

            const update = {
                partnerId: partner.id,
                partnerName: partner.name,
                userId: user._id,
                phoneNumber: normalizedPhone,
                source: "REGISTERED",
                status: user.verified ? "VERIFIED" : "PENDING"
            };
            if (typeof autoSavingsEnabled === "boolean") {
                update.autoSavingsEnabled = autoSavingsEnabled;
                update.autoSavingsEnabledAt = autoSavingsEnabled
                    ? (existingPartnerUser?.autoSavingsEnabledAt || new Date())
                    : null;
            }

            const partnerUser = await PartnerUser.findOneAndUpdate(
                { partnerId: partner.id, userId: user._id },
                {
                    $set: update
                },
                {
                    upsert: true,
                    returnDocument: "after",
                    ...(session ? { session } : {})
                }
            );

            return {
                user,
                partnerUser,
                createdNewUser
            };
        }, { label: "register-partner-user" });

        return {
            userId: result.user._id,
            partnerUserId: result.partnerUser._id,
            phoneNumber: normalizedPhone,
            userVerified: !!result.user.verified,
            requiresOtp: !result.user.verified,
            createdNewUser: result.createdNewUser,
            autoSavingsEnabled: !!result.partnerUser.autoSavingsEnabled
        };
    } catch (error) {
        throw error;
    }
};
