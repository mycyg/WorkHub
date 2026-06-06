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
      "/api/workitems/{id}/proposals": {
        post: {
          tags: ["proposals"],
          summary: "Create a deliverable change proposal from a manifest"
        },
        get: {
          tags: ["proposals"],
          summary: "List proposals for a work item"
        }
      },
      "/api/proposals/{id}": {
        get: {
          tags: ["proposals"],
          summary: "Read a deliverable change proposal"
        }
      },
      "/api/proposals/{id}/review": {
        post: {
          tags: ["proposals"],
          summary: "Review a deliverable change proposal"
        }
      },
      "/api/proposals/{id}/merge": {
        post: {
          tags: ["proposals"],
          summary: "Merge an approved deliverable change proposal"
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
      "/api/cost/usage": {
        get: {
          tags: ["cost"],
          summary: "Current user's lightweight AI budget and usage summary"
        }
      },
      "/api/cost/policies": {
        get: {
          tags: ["cost"],
          summary: "List AI budget policies"
        }
      },
      "/api/cost/policies/{scope}/{id}": {
        put: {
          tags: ["cost"],
          summary: "Update an AI budget policy"
        }
      },
      "/api/workitems/{id}/agent-runs": {
        post: {
          tags: ["agent-runs"],
          summary: "Start an AI worker run for a work item"
        }
      },
      "/api/agent-runs/{id}": {
        get: {
          tags: ["agent-runs"],
          summary: "Read the live state for an AI worker run"
        }
      },
      "/api/agent-runs/{id}/trace": {
        get: {
          tags: ["agent-runs"],
          summary: "Read live trace steps for an AI worker run"
        }
      },
      "/api/agent-runs/{id}/handoff": {
        get: {
          tags: ["agent-runs"],
          summary: "Read the structured handoff for an escalated AI worker run"
        }
      },
      "/api/agent-runs/{id}/abort": {
        post: {
          tags: ["agent-runs"],
          summary: "Cancel a queued or running AI worker run"
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
      "/api/workitems": {
        post: {
          tags: ["workitems"],
          summary: "Create a work item from an intake session or option-first payload"
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
