import express from 'express';
import {
    getPartnerAnalytics,
    getPartnerEvents,
    getPartnerNotificationSummary,
    getPartnerNotifications,
    getPartnerSavingsBehavior,
    getPartnerUserDemoState,
    getPartnerUsers,
    markPartnerNotificationsRead
} from '../controller/partnerDashboard.controller.js';
import { verifyPartnerDashboardSession } from '../middleware/partnerDashboardAuth.middleware.js';

const router = express.Router();

router.get('/events', verifyPartnerDashboardSession, getPartnerEvents);
router.get('/analytics', verifyPartnerDashboardSession, getPartnerAnalytics);
router.get('/savings-behavior', verifyPartnerDashboardSession, getPartnerSavingsBehavior);
router.get('/users', verifyPartnerDashboardSession, getPartnerUsers);
router.get('/user-demo', verifyPartnerDashboardSession, getPartnerUserDemoState);
router.get('/notifications', verifyPartnerDashboardSession, getPartnerNotifications);
router.get('/notifications/summary', verifyPartnerDashboardSession, getPartnerNotificationSummary);
router.patch('/notifications/read-all', verifyPartnerDashboardSession, markPartnerNotificationsRead);

export default router;
