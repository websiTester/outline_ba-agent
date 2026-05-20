import Router from "koa-router";
import { registerAdminRoutes } from "./admin";
import { registerGenerationRoutes } from "./generation";
import { registerPublicRoutes } from "./public";

// BA Kit (M2) router — one flat Router with every action registered on it.
// Each sub-file exports a `registerXxxRoutes(router)` function that attaches
// handlers directly to this shared instance (avoids koa-router's
// nested-router resolution quirks). FastAPI never calls back into Outline
// anymore — section content sync is driven by the FE poll, so there is no
// "internal" endpoint here.
const router = new Router();
registerPublicRoutes(router);
registerAdminRoutes(router);
registerGenerationRoutes(router);

export default router;
