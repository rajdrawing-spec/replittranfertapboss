import { Router, type IRouter } from "express";
import { requireAuth } from "../middleware/auth";
import healthRouter from "./health";
import authRouter from "./auth";
import companiesRouter from "./companies";
import dashboardRouter from "./dashboard";
import ordersRouter from "./orders";
import inventoryRouter from "./inventory";
import financeRouter from "./finance";
import employeesRouter from "./employees";
import crmRouter from "./crm";
import notificationsRouter from "./notifications";
import approvalsRouter from "./approvals";
import aiRouter from "./ai";
import usersRouter from "./users";
import rolesRouter from "./roles";
import auditRouter from "./audit";
import directorRouter from "./director";
import platformsRouter from "./platforms";
import vaultRouter from "./vault";
import shippingRouter from "./shipping";
import documentsRouter from "./documents";
import marketingRouter from "./marketing";
import searchRouter from "./search";

const router: IRouter = Router();

// Public (no auth required)
router.use(healthRouter);
router.use(authRouter);

// All other routes require a valid session cookie
router.use(requireAuth);
router.use(companiesRouter);
router.use(dashboardRouter);
router.use(ordersRouter);
router.use(inventoryRouter);
router.use(financeRouter);
router.use(employeesRouter);
router.use(crmRouter);
router.use(notificationsRouter);
router.use(approvalsRouter);
router.use(aiRouter);
router.use(usersRouter);
router.use(rolesRouter);
router.use(auditRouter);
router.use(directorRouter);
router.use(platformsRouter);
router.use(vaultRouter);
router.use(shippingRouter);
router.use(documentsRouter);
router.use(marketingRouter);
router.use(searchRouter);

export default router;
