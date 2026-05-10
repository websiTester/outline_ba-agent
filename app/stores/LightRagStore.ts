import invariant from "invariant";
import { action, observable, runInAction } from "mobx";
import LightRagSource from "~/models/LightRagSource";
import { client } from "~/utils/ApiClient";
import type RootStore from "./RootStore";
import Store from "./base/Store";
import Logger from "~/utils/Logger";

export default class LightRagStore extends Store<LightRagSource> {
  @observable
  graphNodes: any[] = [];

  @observable
  graphLinks: any[] = [];

  @observable
  pipelineStatus: any = null;

  constructor(rootStore: RootStore) {
    super(rootStore, LightRagSource);
  }

  @action
  fetchStatus = async (): Promise<LightRagSource[]> => {
    this.isFetching = true;

    try {
      const res = await client.post(`/lightrag.status`);
      invariant(res?.data, "Data not available");

      const rawStatuses = res.data.data;
      const pipelineStatus = res.data.pipeline;

      runInAction(`LightRagStore#setPipelineStatus`, () => {
        this.pipelineStatus = pipelineStatus;
      });

      const flatDocs: any[] = [];
      if (rawStatuses && typeof rawStatuses === 'object') {
        for (const [statusGroup, docs] of Object.entries(rawStatuses)) {
          if (Array.isArray(docs)) {
            for (const doc of docs as any[]) {
              // Map Python format to our frontend model format
              flatDocs.push({
                id: doc.id,
                status: doc.status,
                summary: doc.content_summary,
                length: doc.content_length,
                chunks: doc.chunks_count || 0,
                filePath: doc.file_path,
                fileName: doc.file_path ? doc.file_path.split(/[/\\]/).pop() : doc.id,
                errorMsg: doc.error_msg || null,
                createdAt: doc.created_at,
                updatedAt: doc.updated_at
              });
            }
          }
        }
      }

      let models: LightRagSource[] = [];
      runInAction(`LightRagStore#fetchStatus`, () => {
        this.data.clear();
        models = flatDocs.map(doc => this.add(doc));
        this.isLoaded = true;
      });

      return models;
    } catch (err) {
      Logger.error("Failed to fetch lightrag status", err);
      return [];
    } finally {
      this.isFetching = false;
    }
  };

  @action
  uploadSource = async (file: File): Promise<LightRagSource | undefined> => {
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await client.post(`/lightrag.upload`, formData);

      invariant(res?.data, "Data not available");

      let source: LightRagSource | undefined;
      runInAction(`LightRagStore#uploadSource`, () => {
        source = this.add(res.data);
      });
      return source;
    } catch (err) {
      Logger.error("Failed to upload lightrag source", err);
      throw err;
    }
  }

  @action
  deleteSource = async (id: string): Promise<void> => {
    try {
      await client.post(`/lightrag.delete`, { id });
      runInAction(`LightRagStore#deleteSource`, () => {
        this.remove(id);
      });
    } catch (err) {
      Logger.error("Failed to delete lightrag source", err);
      throw err;
    }
  }

  @action
  fetchGraph = async (label: string = "*"): Promise<void> => {
    try {
      const res = await client.post(`/lightrag.graph`, { label });
      invariant(res?.data?.data, "Graph data not available");

      runInAction(`LightRagStore#fetchGraph`, () => {
        this.graphNodes = res.data.data.nodes || [];
        this.graphLinks = res.data.data.edges || [];
      });
    } catch (err) {
      Logger.error("Failed to fetch lightrag graph", err);
    }
  };
}
