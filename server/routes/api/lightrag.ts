import Router from "koa-router";
import auth from "@server/middlewares/authentication";
import type { APIContext } from "@server/types";
import Logger from "@server/logging/Logger";
import FormData from "form-data";
import fs from "fs";
import fetch from "node-fetch";

const router = new Router();

// Ensure trailing slash isn't an issue
const getPythonApiUrl = () => {
  const url = process.env.LIGHTRAG_API_URL || "http://localhost:8000";
  return url.endsWith("/") ? url.slice(0, -1) : url;
};

router.post(
  "lightrag.upload",
  auth(),
  async (ctx: APIContext) => {
    const file = ctx.request.files?.file;
    if (!file) {
      ctx.throw(400, "File is required");
    }

    const fileObj = Array.isArray(file) ? file[0] : file;
    const filePath = (fileObj as any).filepath || (fileObj as any).path;
    const fileName = (fileObj as any).originalFilename || (fileObj as any).name;

    if (!filePath || !fileName) {
      ctx.throw(400, "Invalid file format received");
    }

    try {
      Logger.info("http", `===File path:  ${filePath}, fileName: ${fileName}`)
      const formData = new FormData();
      formData.append("file", fs.createReadStream(filePath), fileName);

      const response = await fetch(`${getPythonApiUrl()}/api/upload-document`, {
        method: "POST",
        headers: {
          "X-Workspace-Id": ctx.state.auth.user.teamId // Hoặc biến chứa ID workspace tương ứng
        },
        body: formData,
      });

      let result: any = null;
      if (response.ok) {
        result = await response.json();
      } else {
        Logger.warn(`LightRAG API returned non-ok status: ${response.status}`);
        ctx.throw(response.status, "LightRAG API upload failed");
      }

      ctx.body = {
        data: {
          id: result?.track_id || result?.doc_id || "unknown",
          fileName,
          status: "pending",
          ...result
        },
        success: true,
      };
    } catch (err: any) {
      Logger.error("Failed to upload lightrag source:", err);
      ctx.throw(err.status || 500, err.message || "Internal Server Error during file proxying");
    } finally {
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  }
);

router.post(
  "lightrag.status",
  auth(),
  async (ctx: APIContext) => {
    try {
      // 1. Trích xuất tham số từ body do Frontend gửi lên
      const {
        status,
        search,
        page = 1,
        page_size = 50,
        sort_field = "updated_at",
        sort_direction = "desc"
      } = ctx.request.body || {};

      // 2. Chuyển đổi các tham số này thành Query String để gọi GET api
      const queryParams = new URLSearchParams();
      if (status) queryParams.append("status", status);
      if (search) queryParams.append("search", search);
      queryParams.append("page", String(page));
      queryParams.append("page_size", String(page_size));
      queryParams.append("sort_field", sort_field);
      queryParams.append("sort_direction", sort_direction);

      // Tham số xác thực Workspace chung cho các request
      const fetchHeaders = {
        "X-Workspace-Id": ctx.state.auth.user.teamId,
      };

      // 3. Fetch documents status với Query Parameters và X-Workspace-Id
      const response = await fetch(`${getPythonApiUrl()}/api/documents?${queryParams.toString()}`, {
        headers: fetchHeaders
      });

      if (!response.ok) {
        ctx.throw(response.status, "Failed to fetch from LightRAG API");
      }
      const result = await response.json();

      // 4. Fetch pipeline status với đúng path và có chứa X-Workspace-Id
      let pipelineResult = null;
      try {
        const pipelineRes = await fetch(`${getPythonApiUrl()}/api/pipeline/status`, {
          headers: fetchHeaders
        });
        if (pipelineRes.ok) pipelineResult = await pipelineRes.json();
      } catch (err) {
        Logger.warn("Failed to fetch pipeline_status", err);
      }

      ctx.body = {
        data: result.documents || result.statuses || result, // Hỗ trợ cả 2 chuẩn response 
        total: result.total,
        page: result.page,
        page_size: result.page_size,
        pipeline: pipelineResult,
        success: true,
      };
    } catch (err: any) {
      Logger.error("Failed to fetch lightrag status:", err);
      ctx.throw(err.status || 500, err.message || "Internal Server Error during status proxying");
    }
  }
);


router.post(
  "lightrag.delete",
  auth(),
  async (ctx: APIContext) => {
    const { id } = ctx.request.body;
    if (!id) {
      ctx.throw(400, "id is required");
    }

    try {
      const response = await fetch(`${getPythonApiUrl()}/api/documents/delete`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "X-Workspace-Id": ctx.state.auth.user.teamId // Thêm thông tin workspace 
        },
        body: JSON.stringify({
          doc_ids: [id],
          delete_file: false,
          delete_llm_cache: false
        })
      });

      if (!response.ok) {
        ctx.throw(response.status, "Failed to delete document from LightRAG API");
      }

      ctx.body = {
        success: true,
      };
    } catch (err: any) {
      Logger.error("Failed to delete lightrag document:", err);
      ctx.throw(err.status || 500, err.message || "Internal Server Error during document deletion proxying");
    }
  }
);

router.post(
  "lightrag.graph",
  auth(),
  async (ctx: APIContext) => {
    // 1. Trích xuất tham số từ body
    const { label = "*", maxDepth = 3, maxNodes = 500 } = ctx.request.body;

    try {
      // 2. Định dạng Parameters để chuyển tham số thành Query String
      const queryParams = new URLSearchParams();
      queryParams.append("label", label);
      queryParams.append("max_depth", String(maxDepth));
      queryParams.append("max_nodes", String(maxNodes));

      // 3. Gọi đến đúng endpoint của Backend (bao gồm cả prefix /api) + truyền Header workspace
      const url = `${getPythonApiUrl()}/api/graphs/nx?${queryParams.toString()}`;
      const response = await fetch(url, {
        method: "GET", // Mặc định fetch là GET, ghi rõ ra cho tường minh logic
        headers: {
          "X-Workspace-Id": ctx.state.auth.user.teamId, // Authenticate để phân rã đồ thị theo team
        }
      });

      if (!response.ok) {
        ctx.throw(response.status, "Failed to fetch graph from LightRAG API");
      }

      // 4. Lấy kết quả node + edge trực tiếp trả về cho client biểu diễn
      const result = await response.json();

      ctx.body = {
        data: result,
        success: true,
      };
    } catch (err: any) {
      Logger.error("Failed to fetch lightrag graph:", err);
      ctx.throw(err.status || 500, err.message || "Internal Server Error during graph proxying");
    }
  }
);


export default router;
