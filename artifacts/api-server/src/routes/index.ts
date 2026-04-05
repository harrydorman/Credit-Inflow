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
import watchlistsRouter from "./watchlists";
import alertsRouter from "./alerts";
import portfoliosRouter from "./portfolios";
import notificationsRouter from "./notifications";

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
router.use(watchlistsRouter);
router.use(alertsRouter);
router.use(portfoliosRouter);
router.use(notificationsRouter);

export default router;
