import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import storageRouter from "./storage.js";
import profilesRouter from "./profiles.js";
import positionRouter from "./position.js";
import evidenceRouter from "./evidence.js";
import transactionsRouter from "./transactions.js";
import inboxRouter from "./inbox.js";
import decisionsRouter from "./decisions.js";
import copilotRouter from "./copilot.js";
import demoRouter from "./demo.js";
import incomeTaxEstimateRouter from "./income-tax-estimate.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(storageRouter);
router.use(profilesRouter);
router.use(positionRouter);
router.use(incomeTaxEstimateRouter);
router.use(evidenceRouter);
router.use(transactionsRouter);
router.use(inboxRouter);
router.use(decisionsRouter);
router.use(copilotRouter);
router.use(demoRouter);

export default router;
