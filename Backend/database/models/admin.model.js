import mongoose from "mongoose";

const adminSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true
        },
        email: {
            type: String,
            required: true,
            unique: true,
            index: true,
            lowercase: true,
            trim: true
        },
        passwordHash: {
            type: String,
            required: true
        },
        passwordSalt: {
            type: String,
            required: true
        },
        apiTokenHash: {
            type: String,
            default: null,
            index: true
        },
        apiTokenIssuedAt: {
            type: Date,
            default: null
        },
        status: {
            type: String,
            enum: ["ACTIVE", "SUSPENDED"],
            default: "ACTIVE"
        },
        lastLoginAt: {
            type: Date,
            default: null
        },
        isPrimaryAdmin: {
            type: Boolean,
            default: false,
            index: true
        }
    },
    { timestamps: true }
);

const Admin = mongoose.model("Admin", adminSchema);

export default Admin;
