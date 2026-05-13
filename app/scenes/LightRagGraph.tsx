import { observer } from "mobx-react";
import React, { useEffect, useState } from "react";
import styled, { useTheme } from "styled-components";
import { formatDistanceToNow } from "date-fns";
import CenteredContent from "~/components/CenteredContent";
import D3KnowledgeGraph from "~/components/D3KnowledgeGraph";
import PageTitle from "~/components/PageTitle";
import Button from "~/components/Button";
import Flex from "~/components/Flex";
import Input from "~/components/Input";
import Tabs from "~/components/Tabs";
import useStores from "~/hooks/useStores";

// ── Graph data logic moved to useMemo below ────────────

function LightRagGraph() {


  return (
    <div>
      Comming soon
    </div>
  );
}

export default observer(LightRagGraph);
