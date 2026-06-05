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
      "/api/pages/gold-path": {
        get: {
          tags: ["pages"],
          summary: "P0.5 gold path page VM bundle"
        }
      },
      "/api/pages/workitems/{id}": {
        get: {
          tags: ["pages"],
          summary: "Work item detail page VM"
        }
      },
      "/api/pages/proposals/{id}": {
        get: {
          tags: ["pages"],
          summary: "Proposal detail page VM"
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
      "/api/sessions": {
        post: {
          tags: ["sessions"],
          summary: "Create a P0.5 intake session"
        }
      },
      "/api/sessions/{id}/next-question": {
        post: {
          tags: ["sessions"],
          summary: "Return an option-first clarification card"
        }
      },
      "/api/knowledge/search": {
        post: {
          tags: ["knowledge"],
          summary: "Search project knowledge and return an evidence bubble"
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
