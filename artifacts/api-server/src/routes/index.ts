import { Router, type IRouter } from "express";
import healthRouter from "./health";
import articlesRouter from "./articles";
import signalsRouter from "./signals";
import issuersRouter from "./issuers";
import ingestionRouter from "./ingestion";
import trendsRouter from "./trends";
import issuerThesisRouter from "./issuerThesis";
import marketOverviewRouter from "./marketOverview";
import debugRouter from "./debug";

const router: IRouter = Router();

router.use(healthRouter);
router.use(articlesRouter);
router.use(signalsRouter);
router.use(issuersRouter);
router.use(ingestionRouter);
router.use(trendsRouter);
router.use(issuerThesisRouter);
router.use(marketOverviewRouter);
router.use(debugRouter);

export default router;
