import jwt from "jsonwebtoken";
import env from "../config.js";
import User from "../../database/models/user.model.js";
import Wallet from "../../database/models/wallet.model.js";
import { runRequiredTransaction } from "../../service/databaseSession.service.js";

const KENYA_PHONE_REGEX = /^\+254\d{9}$/;

export const registerUser = async (req, res) => {
  if (!env.USER_SELF_REGISTRATION_ENABLED) {
    return res.status(403).json({
      success: false,
      error: "Public user self-registration is disabled",
    });
  }

  const { phone } = req.body;
  const normalizePhone = phone?.trim();

  if (!normalizePhone || !KENYA_PHONE_REGEX.test(normalizePhone)) {
    return res.status(400).json({
      success: false,
      error: "Invalid phone number",
    });
  }

  try {
    const created = await runRequiredTransaction(async (session) => {
      const createOptions = session ? { session } : undefined;
      const user = await User.create(
        [{ phoneNumber: normalizePhone }],
        createOptions
      );

      await Wallet.create(
        [{
          userId: user[0]._id,
          balance: 0,
          lastProcessedLedgerId: null,
        }],
        createOptions
      );

      return user[0];
    }, { label: "register-user" });

    // generate a JWT so the client can authenticate subsequent requests
    const token = jwt.sign(
      {
        userId: created._id.toString(),
        phoneNumber: normalizePhone
      },
      env.USER_JWT_SECRET,
      { expiresIn: env.USER_JWT_EXPIRATION }
    );

    return res.status(201).json({
      success: true,
      userId: created._id,
      token
    });

  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        error: "User already exists",
      });
    }

    return res.status(500).json({
      success: false,
      error: "Registration failed",
    });
  }
};
