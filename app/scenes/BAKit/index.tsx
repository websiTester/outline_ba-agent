/**
 * BA Kit (M2) scene entry — owns sub-routes:
 *   /ba-kit          → Gallery landing (templates + recent jobs)
 *   /ba-kit/jobs/:id → JobView progress page
 */

import { observer } from "mobx-react";
import { lazy, Suspense } from "react";
import { Route, Switch } from "react-router-dom";

// Code-split each page so initial sidebar click doesn't load the JobView shell.
const Gallery = lazy(() => import("./pages/Gallery"));
const JobView = lazy(() => import("./pages/JobView"));

function BAKitScene() {
  // Two sub-routes scoped under /ba-kit; both render under the same Authenticated layout.
  return (
    <Suspense fallback={null}>
      <Switch>
        <Route exact path="/ba-kit" component={Gallery} />
        <Route exact path="/ba-kit/jobs/:jobId" component={JobView} />
      </Switch>
    </Suspense>
  );
}

export default observer(BAKitScene);
