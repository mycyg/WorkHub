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
      "/api/auth/register": {
        post: {
          tags: ["auth"],
          summary: "Password registration (AUTH_MODE!=nickname); first user bootstraps as admin"
        }
      },
      "/api/auth/login": {
        post: {
          tags: ["auth"],
          summary: "Password login (AUTH_MODE!=nickname); mints a server-side session cookie"
        }
      },
      "/api/auth/logout": {
        post: {
          tags: ["auth"],
          summary: "Rotate the cookie token, revoke the session, and clear the session cookie"
        }
      },
      "/api/auth/password": {
        post: {
          tags: ["auth"],
          summary: "Change the current user's password (AUTH_MODE!=nickname); rotates sessions"
        }
      },
      "/api/auth/users/{id}/deactivate": {
        post: {
          tags: ["auth"],
          summary: "Admin: deactivate a user (soft-delete + revoke sessions/devices)"
        }
      },
      "/api/auth/invites": {
        post: {
          tags: ["auth"],
          summary: "Admin: create an out-of-band invite, returns a one-time token"
        }
      },
      "/api/auth/invites/accept": {
        post: {
          tags: ["auth"],
          summary: "Accept an invite token: create account + credential + membership + session"
        }
      },
      "/api/auth/preferences": {
        patch: {
          tags: ["auth"],
          summary: "Update the current user's lightweight preferences such as locale"
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
      "/api/pages/drive": {
        get: {
          tags: ["pages"],
          summary: "Project drive page VM"
        }
      },
      "/api/pages/meetings": {
        get: {
          tags: ["pages"],
          summary: "Meeting insights page VM"
        }
      },
      "/api/pages/notifications": {
        get: {
          tags: ["pages"],
          summary: "Notification inbox page VM grouped by decision, FYI, and done"
        }
      },
      "/api/pages/calendar": {
        get: {
          tags: ["pages"],
          summary: "Calendar page VM with schedule events, work item due dates, and meeting follow-ups"
        }
      },
      "/api/pages/health": {
        get: {
          tags: ["pages"],
          summary: "Project health page VM with permission-filtered signal bands per project"
        }
      },
      "/api/drive/projects/{projectId}/files": {
        post: {
          tags: ["drive"],
          summary: "Upload a minimal project drive file and return the refreshed Drive Page VM"
        }
      },
      "/api/drive/projects/{projectId}/items/{itemId}/delete": {
        post: {
          tags: ["drive"],
          summary: "Move a project drive item to the recycle area"
        }
      },
      "/api/drive/projects/{projectId}/items/{itemId}/restore": {
        post: {
          tags: ["drive"],
          summary: "Restore a recycled project drive item"
        }
      },
      "/api/drive/projects/{projectId}/comments/{commentId}/draft": {
        post: {
          tags: ["drive"],
          summary: "Create or return a work item draft from a project drive comment"
        }
      },
      "/api/drive/workitems/{workItemId}/proposal-draft": {
        post: {
          tags: ["drive"],
          summary: "Create or return a deterministic proposal from a Drive comment work item draft"
        }
      },
      "/api/meetings/projects/{projectId}/insights/{insightId}/draft": {
        post: {
          tags: ["meetings"],
          summary: "Create or return a work item draft from a meeting insight"
        }
      },
      "/api/meetings/projects/{projectId}/insights/{insightId}/dismiss": {
        post: {
          tags: ["meetings"],
          summary: "Dismiss a pending meeting insight"
        }
      },
      "/api/meetings/workitems/{workItemId}/proposal-draft": {
        post: {
          tags: ["meetings"],
          summary: "Create or return a deterministic proposal from a meeting-created work item draft"
        }
      },
      "/api/notifications/{id}/read": {
        post: {
          tags: ["notifications"],
          summary: "Mark one notification as read"
        }
      },
      "/api/notifications/read-all": {
        post: {
          tags: ["notifications"],
          summary: "Mark all current user's notifications as read"
        }
      },
      "/api/notifications/{id}/dismiss": {
        post: {
          tags: ["notifications"],
          summary: "Dismiss and archive one notification"
        }
      },
      "/api/notifications/{id}/complete": {
        post: {
          tags: ["notifications"],
          summary: "Complete and archive one notification"
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
      "/api/workitems/{id}/conflicts": {
        get: {
          tags: ["proposals"],
          summary: "List current proposal conflicts and clickable resolution options for a work item"
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
          summary: "Create an option-first intake session"
        }
      },
      "/api/sessions/{id}/next-question": {
        post: {
          tags: ["sessions"],
          summary: "Return an option-first clarification card",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    selected_option_ids: {
                      type: "array",
                      items: { type: "string" }
                    },
                    free_text: { type: "string" }
                  },
                  additionalProperties: false
                }
              }
            }
          }
        }
      },
      "/api/workitems": {
        post: {
          tags: ["workitems"],
          summary: "Create a work item from an intake session or option-first payload"
        }
      },
      "/api/workitems/{id}/evidence-bindings": {
        post: {
          tags: ["workitems"],
          summary: "Attach selected evidence refs to the current work item context"
        }
      },
      "/api/workitems/{id}/deliverables/{acceptedChangeId}/download": {
        get: {
          tags: ["workitems"],
          summary: "Download an accepted formal deliverable file"
        }
      },
      "/api/workitems/{id}/deliverables/{acceptedChangeId}/preview": {
        get: {
          tags: ["workitems"],
          summary: "Preview an accepted formal deliverable when it is text-like"
        }
      },
      "/api/workitems/{id}/deliverables/{acceptedChangeId}/restore": {
        post: {
          tags: ["workitems"],
          summary: "Restore an accepted formal deliverable to its previous version"
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
