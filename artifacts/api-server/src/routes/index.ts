import { Router, type IRouter } from "express";
import healthRouter from "./health";
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

const router: IRouter = Router();

router.use(healthRouter);
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

export default router;
