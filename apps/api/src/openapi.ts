export function getOpenApiDocument() {
  return {
    openapi: "3.1.0",
    info: {
      title: "WorkHub Headless Agent Daemon",
      version: "0.1.0"
    },
    paths: {
      "/api/health": {
        get: {
          tags: ["system"],
          summary: "Check daemon health"
        }
      },
      "/api/pages/attention": {
        get: {
          tags: ["pages"],
          summary: "AI-first attention home page"
        }
      },
      "/api/pages/approvals": {
        get: {
          tags: ["pages"],
          summary: "Approval center page"
        }
      },
      "/api/pages/cost": {
        get: {
          tags: ["pages"],
          summary: "Cost dashboard page"
        }
      },
      "/api/workitems/{id}/agent-runs": {
        post: {
          tags: ["agent-runs"],
          summary: "Start an AI worker run for a work item"
        }
      },
      "/api/agent-runs/{id}/replay": {
        get: {
          tags: ["agent-runs"],
          summary: "Replay an AI worker run"
        }
      },
      "/api/workitems/{id}/audit": {
        get: {
          tags: ["audit"],
          summary: "List audit facts and snapshots for a work item"
        }
      }
    }
  };
}
