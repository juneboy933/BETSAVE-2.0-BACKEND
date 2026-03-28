import dotenv from "dotenv";
import mongoose from "mongoose";
import Admin from "./database/models/admin.model.js";
import {
  generateAdminToken,
  generateSalt,
  hashPassword,
  hashToken
} from "./service/adminAuth.service.js";

dotenv.config();

const DEFAULT_MONGO_URI = "mongodb://localhost:27017/betsave";
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const parseArgs = (argv) => {
  const parsed = { insert: false };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--insert") {
      parsed.insert = true;
      continue;
    }

    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for argument ${token}`);
    }
    parsed[key] = value;
    index += 1;
  }

  return parsed;
};

const printUsage = () => {
  console.log("Usage:");
  console.log('  node generateAdminHash.js --name "System Admin" --email "admin@example.com" --password "StrongPassword123" [--insert]');
  console.log("");
  console.log("Behavior:");
  console.log("  Without --insert: prints the generated admin payload and API token without touching the database.");
  console.log("  With --insert: writes the admin record to MongoDB if the email does not already exist.");
};

const validateInput = ({ name, email, password }) => {
  const normalizedName = String(name || "").trim();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedPassword = String(password || "");

  if (!normalizedName || !normalizedEmail || !normalizedPassword) {
    throw new Error("name, email and password are required");
  }

  if (!EMAIL_REGEX.test(normalizedEmail)) {
    throw new Error("email must be a valid address");
  }

  if (normalizedPassword.length < 12) {
    throw new Error("password must be at least 12 characters");
  }

  return {
    name: normalizedName,
    email: normalizedEmail,
    password: normalizedPassword
  };
};

const buildAdminPayload = ({ name, email, password }) => {
  const passwordSalt = generateSalt();
  const passwordHash = hashPassword(password, passwordSalt);
  const apiToken = generateAdminToken();
  const apiTokenHash = hashToken(apiToken);

  return {
    apiToken,
    document: {
      name,
      email,
      passwordHash,
      passwordSalt,
      status: "ACTIVE",
      apiTokenHash,
      apiTokenIssuedAt: new Date(),
      lastLoginAt: new Date()
    }
  };
};

const printResult = ({ name, email, password }, { document, apiToken }, insertedAdminId = null) => {
  console.log("=== Admin Bootstrap Payload ===");
  console.log(`Name: ${name}`);
  console.log(`Email: ${email}`);
  console.log(`Password: ${password}`);
  console.log(`Password Salt: ${document.passwordSalt}`);
  console.log(`Password Hash: ${document.passwordHash}`);
  console.log(`Admin Token: ${apiToken}`);
  console.log(`Admin Token Hash: ${document.apiTokenHash}`);
  if (insertedAdminId) {
    console.log(`Admin ID: ${insertedAdminId}`);
  }
};

const maybeInsertAdmin = async ({ insert, mongoUri, adminData }) => {
  if (!insert) {
    return null;
  }

  await mongoose.connect(mongoUri || process.env.MONGO_URI || DEFAULT_MONGO_URI);

  const existing = await Admin.findOne({ email: adminData.document.email }).select("_id");
  if (existing) {
    throw new Error(`admin with email ${adminData.document.email} already exists`);
  }

  const adminCount = await Admin.countDocuments();
  adminData.document.isPrimaryAdmin = adminCount === 0;
  const admin = await Admin.create(adminData.document);
  return admin._id;
};

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      printUsage();
      return;
    }

    const input = validateInput(args);
    const adminData = buildAdminPayload(input);
    const insertedAdminId = await maybeInsertAdmin({
      insert: args.insert,
      mongoUri: args.mongoUri,
      adminData
    });

    printResult(input, adminData, insertedAdminId ? String(insertedAdminId) : null);

    if (!args.insert) {
      console.log("");
      console.log("No database write performed. Re-run with --insert to create the admin record.");
    }
  } catch (error) {
    console.error(`Admin bootstrap failed: ${error.message}`);
    printUsage();
    process.exitCode = 1;
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }
}

main();
