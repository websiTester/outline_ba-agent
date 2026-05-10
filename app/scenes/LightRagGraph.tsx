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
  const { lightRagSources } = useStores();
  const theme = useTheme();

  const [activeMainTab, setActiveMainTab] = useState("documents");
  const [activeFilterTab, setActiveFilterTab] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    void lightRagSources.fetchStatus();
    void lightRagSources.fetchGraph();

    const interval = setInterval(() => {
      const hasActiveDocs = Array.from(lightRagSources.data.values()).some((d) =>
        ["pending", "processing", "preprocessed"].includes(d.status)
      );
      const isPipelineBusy = lightRagSources.pipelineStatus?.is_busy;

      if (!lightRagSources.isLoaded || hasActiveDocs || isPipelineBusy) {
        void lightRagSources.fetchStatus();
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [lightRagSources]);

  // Transform Python API graph data into D3 interface
  const d3Nodes = React.useMemo(() => {
    return lightRagSources.graphNodes.map((n: any) => ({
      id: n.id,
      label: n.id,
      metadata: n.properties,
      group: n.labels ? n.labels[0]?.charCodeAt(0) % 10 : 0
    }));
  }, [lightRagSources.graphNodes]);

  const d3Links = React.useMemo(() => {
    return lightRagSources.graphLinks.map((e: any) => ({
      source: e.source,
      target: e.target,
      label: e.type,
    }));
  }, [lightRagSources.graphLinks]);

  // Filtering Logic
  let sources = lightRagSources.orderedData;

  if (searchQuery) {
    sources = sources.filter((s) =>
      s.fileName.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }

  if (activeFilterTab !== "all") {
    const filterMap: Record<string, string> = {
      pending: "pending",
      processing: "processing",
      processed: "processed",
      failed: "failed",
      preprocessed: "preprocessed",
    };
    sources = sources.filter((s) => s.status === filterMap[activeFilterTab]);
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    try {
      setIsUploading(true);

      const validFiles: File[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.size > 20 * 1024 * 1024) {
          window.alert(`File "${file.name}" exceeds 20 MB limit and will be skipped.`);
        } else {
          validFiles.push(file);
        }
      }

      await Promise.all(validFiles.map((file) => lightRagSources.uploadSource(file)));
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  return (
    <CenteredContent>
      <PageTitle title="LightRAG UI" />
      <Container>
        <h1>Knowledge Graph</h1>

        {/* Main Tabs */}
        <Tabs>
          <MainTabButton
            active={activeMainTab === "documents"}
            onClick={() => setActiveMainTab("documents")}
          >
            Documents
          </MainTabButton>
          <MainTabButton
            active={activeMainTab === "graph"}
            onClick={() => setActiveMainTab("graph")}
          >
            Knowledge Graph
          </MainTabButton>
        </Tabs>

        {/* ── Documents Tab ─────────────────────────────────────────────── */}
        {activeMainTab === "documents" && (
          <TabContent>
            <Flex
              justify="space-between"
              align="center"
              style={{ marginBottom: "20px" }}
            >
              <input
                type="file"
                multiple
                accept=".txt,.md,.docx"
                ref={fileInputRef}
                style={{ display: "none" }}
                onChange={handleFileChange}
              />
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
              >
                {isUploading ? "Uploading…" : "Upload Document"}
              </Button>
              <Input
                type="search"
                placeholder="Search by file name…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ marginBottom: 0, width: "300px" }}
              />
            </Flex>

            {/* Status filter bar */}
            <Flex
              style={{
                margin: "16px 0",
                gap: "12px",
                borderBottom: `1px solid ${theme.divider}`,
              }}
            >
              {[
                "all",
                "processed",
                "preprocessed",
                "processing",
                "pending",
                "failed",
              ].map((status) => (
                <FilterTab
                  key={status}
                  active={activeFilterTab === status}
                  onClick={() => setActiveFilterTab(status)}
                >
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </FilterTab>
              ))}
            </Flex>

            <TableWrapper>
              <StyledTable>
                <thead>
                  <tr>
                    <th>
                      <input type="checkbox" />
                    </th>
                    <th>ID</th>
                    <th>Document Name</th>
                    <th>Summary</th>
                    <th>Status</th>
                    <th>Length</th>
                    <th>Chunks</th>
                    <th>Created</th>
                    <th>Updated</th>
                    <th>Options</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((source) => (
                    <tr key={source.id}>
                      <td>
                        <input type="checkbox" />
                      </td>
                      <td>{source.id.substring(0, 16)}…</td>
                      <td>
                        <strong>{source.fileName}</strong>
                      </td>
                      <td>{source.summary ?? "–"}</td>
                      <td>
                        <StatusBadge status={source.status}>
                          {source.status}
                        </StatusBadge>
                      </td>
                      <td>{source.length ?? 0}</td>
                      <td>{source.chunks ?? 0}</td>
                      <td>{source.createdAt ? formatDistanceToNow(new Date(source.createdAt), { addSuffix: true }) : '–'}</td>
                      <td>{source.updatedAt ? formatDistanceToNow(new Date(source.updatedAt), { addSuffix: true }) : '–'}</td>
                      <td>
                        <Button
                          small
                          neutral
                          onClick={() =>
                            lightRagSources.deleteSource(source.id)
                          }
                        >
                          Delete
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {sources.length === 0 && (
                    <tr>
                      <td
                        colSpan={10}
                        style={{ textAlign: "center", padding: "30px 0" }}
                      >
                        No sources match the selected criteria.
                      </td>
                    </tr>
                  )}
                </tbody>
              </StyledTable>
            </TableWrapper>
          </TabContent>
        )}

        {/* ── Knowledge Graph Tab ───────────────────────────────────────── */}
        {activeMainTab === "graph" && (
          <TabContent>
            <GraphToolbar>
              <span style={{ fontSize: 13, opacity: 0.6 }}>
                Showing up to 200 nodes. Click a node to inspect metadata.
              </span>
              <Button
                small
                onClick={() => lightRagSources.fetchGraph()}
                disabled={lightRagSources.isFetching}
              >
                {lightRagSources.isFetching ? "Loading…" : "Refresh Graph"}
              </Button>
            </GraphToolbar>
            <D3KnowledgeGraph
              height={580}
              nodes={d3Nodes}
              links={d3Links}
            />
          </TabContent>
        )}
      </Container>
    </CenteredContent>
  );
}

// ── Styled Components ──────────────────────────────────────────────────────

const Container = styled.div`
  margin-top: 40px;
  width: 100%;
`;

const TabContent = styled.div`
  margin-top: 24px;
`;

const MainTabButton = styled.button<{ active: boolean }>`
  background: none;
  border: none;
  border-bottom: 2px solid
    ${(props) => (props.active ? props.theme.text : "transparent")};
  color: ${(props) =>
    props.active ? props.theme.text : props.theme.textTertiary};
  padding: 8px 16px;
  font-size: 16px;
  font-weight: 500;
  cursor: pointer;
  margin-right: 16px;

  &:hover {
    color: ${(props) => props.theme.text};
  }
`;

const FilterTab = styled(MainTabButton)`
  font-size: 14px;
  padding: 8px 12px;
  margin-right: 8px;
`;

const TableWrapper = styled.div`
  width: 100%;
  overflow-x: auto;
  border: 1px solid ${(props) => props.theme.divider};
  border-radius: 8px;
`;

const StyledTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  text-align: left;

  th,
  td {
    padding: 12px 16px;
    border-bottom: 1px solid ${(props) => props.theme.divider};
    white-space: nowrap;

    &:nth-child(4) {
      white-space: normal;
      min-width: 200px;
      max-width: 300px;
    }
  }

  th {
    background: ${(props) => props.theme.backgroundSecondary};
    font-weight: 500;
    font-size: 14px;
    color: ${(props) => props.theme.textSecondary};
  }

  td {
    font-size: 14px;
    color: ${(props) => props.theme.text};
  }

  tr:last-child td {
    border-bottom: none;
  }
`;

const GraphToolbar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
`;

const StatusBadge = styled.span<{ status: string }>`
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  background: ${(props) => {
    switch (props.status) {
      case "processed":
      case "done":
        return props.theme.brand.green;
      case "failed":
      case "error":
        return props.theme.danger;
      case "processing":
        return props.theme.warning;
      case "preprocessed":
        return props.theme.slate;
      default:
        return props.theme.placeholder;
    }
  }};
  color: white;
  text-transform: uppercase;
`;

export default observer(LightRagGraph);
