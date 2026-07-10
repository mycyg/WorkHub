import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ProposalMutationEditor, type ProposalMutationEditorProps } from "./react-route-mount.js";

test("proposal mutation editor renders readable field labels while keeping raw action selectors", () => {
  const props: ProposalMutationEditorProps = {
    locale: "en-US",
    conflictId: "conflict-1",
    field: "title",
    valueType: "string",
    beforeSummary: "Old title",
    currentSummary: "Old title",
    afterSummary: "New title",
    href: "/api/merge-proposals/merge-1/apply",
    method: "POST",
    actionId: "apply_ai_fusion",
    acceptOnlyPayload: "{\"confirm\":true}",
    keepCurrentPayload: "{\"confirm\":true}",
    customTemplatePayload: "{\"confirm\":true}"
  };

  const html = renderToStaticMarkup(createElement(ProposalMutationEditor, props));

  assert.equal(html.includes("Field: Title"), true);
  assert.equal(html.includes("Field: title"), false);
  assert.equal(html.includes('data-structured-field="title"'), true);
  assert.equal(html.includes('data-proposal-structured-field-editor-row="title"'), true);
});
