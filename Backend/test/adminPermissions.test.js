import test from "node:test";
import assert from "node:assert/strict";

import Admin from "../database/models/admin.model.js";
import { canAdminManageInvitations } from "../service/adminPermissions.service.js";

const originalFindById = Admin.findById;
const originalExists = Admin.exists;
const originalFindOne = Admin.findOne;

test("primary admin can manage invitations", async () => {
    Admin.findById = () => ({
        select: () => ({
            lean: async () => ({
                _id: "507f1f77bcf86cd799439011",
                isPrimaryAdmin: true,
                createdAt: new Date("2026-01-01T00:00:00.000Z")
            })
        })
    });

    const allowed = await canAdminManageInvitations("507f1f77bcf86cd799439011");
    assert.equal(allowed, true);
});

test("oldest admin can manage invitations when legacy data has no primary flag", async () => {
    Admin.findById = () => ({
        select: () => ({
            lean: async () => ({
                _id: "507f1f77bcf86cd799439011",
                isPrimaryAdmin: false,
                createdAt: new Date("2026-01-01T00:00:00.000Z")
            })
        })
    });
    Admin.exists = async () => false;
    Admin.findOne = () => ({
        sort: () => ({
            select: () => ({
                lean: async () => ({
                    _id: "507f1f77bcf86cd799439011",
                    isPrimaryAdmin: false,
                    createdAt: new Date("2026-01-01T00:00:00.000Z")
                })
            })
        })
    });

    const allowed = await canAdminManageInvitations("507f1f77bcf86cd799439011");
    assert.equal(allowed, true);
});

test("non-primary admin is blocked when a primary admin exists", async () => {
    Admin.findById = () => ({
        select: () => ({
            lean: async () => ({
                _id: "507f1f77bcf86cd799439012",
                isPrimaryAdmin: false,
                createdAt: new Date("2026-01-02T00:00:00.000Z")
            })
        })
    });
    Admin.exists = async () => true;

    const allowed = await canAdminManageInvitations("507f1f77bcf86cd799439012");
    assert.equal(allowed, false);
});

test.after(() => {
    Admin.findById = originalFindById;
    Admin.exists = originalExists;
    Admin.findOne = originalFindOne;
});
