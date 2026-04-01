import { Router, type IRouter } from "express";
import healthRouter from "./health";
import articlesRouter from "./articles";
import signalsRouter from "./signals";
import ingestionRouter from "./ingestion";

const router: IRouter = Router();

router.use(healthRouter);
router.use(articlesRouter);
router.use(signalsRouter);
router.use(ingestionRouter);

export default router;
