import mongoose from "mongoose";
import Admin from "../database/models/admin.model.js";

const selectAdminPermissionFields = "_id isPrimaryAdmin createdAt";

export const canAdminManageInvitations = async (adminId) => {
    if (!mongoose.Types.ObjectId.isValid(adminId)) {
        return false;
    }

    const admin = await Admin.findById(adminId).select(selectAdminPermissionFields).lean();
    if (!admin) {
        return false;
    }

    if (admin.isPrimaryAdmin) {
        return true;
    }

    const primaryAdminExists = await Admin.exists({ isPrimaryAdmin: true });
    if (primaryAdminExists) {
        return false;
    }

    const oldestAdmin = await Admin.findOne({})
        .sort({ createdAt: 1, _id: 1 })
        .select(selectAdminPermissionFields)
        .lean();

    if (!oldestAdmin) {
        return false;
    }

    return String(oldestAdmin._id) === String(admin._id);
};
