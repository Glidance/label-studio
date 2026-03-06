Got it — you want two things:

1. A **properly detailed backlog** of 1–3 point tickets that covers the whole scope (backend, frontend, ops, docs, tests).
2. A **walkthrough testing document** that a real human can follow end-to-end (not a list of “tasks”, but a guided flow with what to click, what to expect, what to record).

Below are both.

---

# Part 1 — Detailed sprint-point backlog (1–3 points each)

I’m sizing with the assumption your team knows the Label Studio codebase and can move quickly, but also that you want low-risk changes that will survive rebases.

## Epic 0 — Freeze semantics (so “approval” means one thing everywhere)

### LS-APP-01 (1 pt) Define the per-annotation approval contract

**Goal**
Lock in exactly what “approved/rejected/unreviewed” means **per annotation** and how it behaves when the annotation changes.

**Definition**

* Approval is stored on **annotation**, not task.
* Storage uses existing `Annotation` fields:

  * `last_action`: `"accepted"` or `"rejected"` (and “unreviewed” is anything else / null)
  * `last_created_by`: reviewer user who approved/rejected
* When labeler edits an approved/rejected annotation and clicks **Update/Submit** → status resets to Unreviewed (no stale approvals).

**Deliverable**

* `/docs/annotation_approval_spec.md` describing:

  * state transitions
  * UI rules
  * API contract
  * downstream filtering contract (dataset builder rules)

**Acceptance**

* Spec reviewed and agreed by at least one reviewer + one engineer.

---

## Epic 1 — Config + capability gating (ENV allowlist, feature flag)

### LS-APP-02 (1 pt) Add ENV parsing for reviewer allowlist

**Goal**
Support `LS_REVIEW_APPROVERS="a@x.com,b@y.com"`.

**Implementation notes**

* Parse into a `set[str]`:

  * split by comma
  * strip whitespace
  * lowercase
  * ignore empty entries

**Acceptance**

* Unit tests cover:

  * whitespace
  * capitalization differences
  * trailing commas

---

### LS-APP-03 (1 pt) Add feature flag `LS_REVIEW_ENABLED`

**Goal**
Allow turning this feature on/off without code changes.

**Rules**

* If disabled:

  * API endpoints return 404 or 403 (choose one, document it)
  * UI hides badge/buttons

**Acceptance**

* Flag documented in spec + deployment docs
* Basic test verifying off-mode blocks review actions

---

### LS-APP-04 (2 pts) Add backend helper `can_review(user)` and “capability” exposure

**Goal**
Backend is source-of-truth: who can see/use approve/reject.

**Implementation options**

* Preferred: extend existing “current user / whoami” response with:

  * `review.enabled`
  * `review.can_review`
* Alternate: add a small endpoint `GET /api/review/me`

**Acceptance**

* Frontend can reliably determine `can_review` without hardcoding
* Capability is correct for:

  * allowlisted reviewer
  * normal outsider labeler

---

## Epic 2 — Backend API for approve/reject (per annotation)

### LS-APP-05 (3 pts) Create endpoint: approve annotation

**Goal**
`POST /api/annotations/<id>/approve` updates only review state.

**Behavior**

* Require auth
* Require `LS_REVIEW_ENABLED`
* Require `can_review(user)` based on env allowlist
* Update:

  * `annotation.last_action = "accepted"`
  * `annotation.last_created_by = request.user`
  * (optional) `annotation.updated_by = request.user` if your version uses it consistently
* Return updated annotation JSON

**Acceptance**

* Approver can approve any annotation
* Non-approver gets 403
* Refresh shows persisted approved status

---

### LS-APP-06 (3 pts) Create endpoint: reject annotation

**Goal**
`POST /api/annotations/<id>/reject`

**Behavior**

* Same gating as approve
* Update:

  * `annotation.last_action = "rejected"`
  * `annotation.last_created_by = request.user`

**Acceptance**

* Same as approve, but rejected

---

### LS-APP-07 (2 pts) Add “review fields cannot be tampered” protection

**Goal**
Outsiders must not be able to “approve themselves” via PATCH/PUT to annotations.

**Implementation**

* In annotation update serializer / view:

  * If request payload attempts to set `last_action` to accepted/rejected OR set `last_created_by`
  * and `can_review(user)` is false → reject (403) or strip fields (reject is cleaner for security)

**Acceptance**

* Attempted tampering by a labeler fails
* Normal annotation updates still work for labelers (no regressions)

---

### LS-APP-08 (3 pts) Reset approval when annotation result changes

**Goal**
No stale approvals after edits.

**Rules**

* On **any** annotation save/update that changes `result`:

  * If `last_action` was accepted/rejected → set to Unreviewed
* Define “Unreviewed” precisely:

  * simplest: set `last_action = "updated"` (or `"submitted"`) and clear `last_created_by`
  * OR set `last_action = null` (if safe in your UI logic)

**Acceptance**

* Approved annotation edited by labeler → becomes Unreviewed immediately after Update
* Persisted after refresh

**Edge behavior to confirm**

* If reviewer opens annotation and clicks Approve without editing, it stays approved.

---

### LS-APP-09 (2 pts) Ensure approval info is included everywhere you need it

**Goal**
Dataset building and UI both require fields.

**Checks**

* Confirm `GET task` / `GET annotations` payload includes:

  * `last_action`
  * `last_created_by` (with email)
* Confirm export includes those fields (or add them).

**Acceptance**

* Exported JSON includes acceptance status for each annotation
* Document “filter logic” for dataset builder

---

## Epic 3 — Frontend UI: bottom-bar buttons + status badge

### LS-APP-10 (3 pts) Add Approve/Reject buttons beside Update/Submit

**Goal**
Exactly what you sketched: buttons in the bottom bar near **Update**.

**UI rules**

* Only visible if:

  * feature enabled
  * `can_review === true`
* Only enabled if:

  * there is a “current annotation” selected (has id)
  * no unsaved changes (recommended; otherwise you approve a state the backend may not have)

**Acceptance**

* Reviewer sees buttons next to Update
* Labeler never sees them
* Buttons do not overlap existing controls (auto-annotation toggles etc.)

---

### LS-APP-11 (2 pts) Add review status badge next to the buttons

**Goal**
Make status obvious at a glance.

**Display**

* Unreviewed (neutral)
* Approved (accepted)
* Rejected

**Tooltip**

* “Approved by reviewer@email”
* “Rejected by reviewer@email”

**Acceptance**

* Badge updates instantly after approve/reject
* Persists after reload

---

### LS-APP-12 (2 pts) Wire frontend to backend review endpoints + robust error handling

**Goal**
Button actually changes state; users get feedback.

**Behavior**

* On click:

  * show loading spinner/disabled state
  * call endpoint
  * update local store with returned annotation
* On 403:

  * show toast: “You are not authorized to approve/reject.”

**Acceptance**

* No silent failures
* No “needs refresh to update UI” behavior

---

### LS-APP-13 (2 pts) Correctly target the *current* annotation in a multi-annotation task

**Goal**
When there are multiple annotations (outsiders), approval applies to the one currently displayed.

**Implementation**

* Identify the “active annotation” in the editor state/store
* Approve/reject uses that ID
* If user switches annotation tab → badge/buttons reflect the newly selected annotation

**Acceptance**

* Approving one annotation does not accidentally approve another
* Switching between annotations reflects correct status each time

---

### LS-APP-14 (1 pt) UI polish: keyboard + spacing + accessibility sanity

**Goal**
Make it fast for reviewers.

**Nice usability**

* Buttons remain visible even when right panel scrolls
* Tab order sensible
* Prevent accidental double-click duplicate requests

**Acceptance**

* No layout regression in your typical screen sizes

---

## Epic 4 — Ops + rollout safety

### LS-APP-15 (1 pt) Add env vars to deployment manifests + document

**Goal**
Make it configurable for your deployment.

**Deliverable**

* Update helm/k8s/docker compose:

  * `LS_REVIEW_ENABLED`
  * `LS_REVIEW_APPROVERS`

**Acceptance**

* Changing allowlist requires only env change + restart (expected)
* Doc includes example values

---

### LS-APP-16 (2 pts) Add “safe rollback” instructions

**Goal**
If something breaks, disable feature cleanly.

**Acceptance**

* Document:

  * set `LS_REVIEW_ENABLED=false`
  * what happens to existing approvals (they remain stored, UI hidden)

---

## Epic 5 — Automated tests (not UAT; this is engineering confidence)

### LS-APP-17 (3 pts) Backend test suite for review flows

**Coverage**

* allowlisted user can approve/reject
* non-allowlisted cannot
* tampering prevented
* editing resets approval

**Acceptance**

* Tests pass in CI/local
* Covers the important edge cases

---

### LS-APP-18 (2 pts) Frontend smoke test / minimal regression coverage

**Scope**

* Even 1–2 Playwright/Cypress checks or a lightweight component test:

  * reviewer sees buttons
  * labeler does not
  * badge changes after approve

**Acceptance**

* Prevents accidental UI disappearance in future rebases

---

# Part 2 — Walkthrough testing document (human-friendly, end-to-end)

This is written as a **real “do this, then do that” walkthrough** for a reviewer + labeler pair. It also tells them what evidence to capture.

You can paste this into Notion/Confluence as-is.

---

## Label Studio Per-Annotation Approval Walkthrough (UAT)

### Purpose

Validate that reviewers can quickly approve/reject **specific annotations** created by external labelers, directly from the labeling UI, and that the status is:

* visible next to the Update/Submit button
* persisted after refresh
* reset when the labeler edits the annotation
* available for later dataset filtering/export

### Roles used in this walkthrough

* **Labeler (Outsider)**: external annotator (NOT allowlisted)
* **Reviewer (Approver)**: internal reviewer (allowlisted via ENV)

### What you will record during UAT

For each section, record:

* Pass/Fail
* Screenshot of the bottom bar (showing Update + Approve/Reject + badge)
* Annotation ID(s) you tested (copy from the UI / API response)
* Any unexpected behavior or confusion

---

## A) One-time setup checklist (Admin/Engineer)

1. Set environment variables on the Label Studio server:

   * `LS_REVIEW_ENABLED=true`
   * `LS_REVIEW_APPROVERS=reviewer1@company.com,reviewer2@company.com`
2. Restart Label Studio.
3. Confirm you have:

   * At least 1 project with imported tasks (images)
   * External labeler user account exists
   * Reviewer user account exists and matches allowlist email exactly
4. Pick a test task you can identify easily (e.g., by file_name).

**Expected result**

* Reviewer account will see Approve/Reject controls; labeler will not.

---

## B) Labeler flow: create an annotation (Outsider)

### B1 — Login and open a task

1. Login as the **Labeler**.
2. Go to the project.
3. Open any task in labeling view (one image).

**Expected**

* You see the normal labeling UI.
* You **do not** see Approve/Reject buttons near Update/Submit.

Take screenshot of bottom bar.

---

### B2 — Create an annotation and save it

1. Add/edit labels (polygon, brush, keypoints — anything).
2. Ensure you can see changes in the canvas.
3. Click **Update** (or Submit, depending on what the UI calls it).
4. Refresh the page (hard refresh).
5. Re-open the same task if needed.

**Expected**

* The annotation exists after refresh (nothing lost).
* Status should be **Unreviewed** (badge may show Unreviewed if visible to all; if badge is reviewer-only, that’s acceptable as long as reviewers see it).
* Labeler still cannot see Approve/Reject.

Record:

* Task ID and annotation ID (if visible)
* Screenshot of bottom bar

---

## C) Reviewer flow: approve/reject that exact annotation

### C1 — Login as reviewer and select the correct annotation

1. Login as **Reviewer**.
2. Open the same project and task the labeler just worked on.
3. If multiple annotations exist for the task:

   * Use the annotation selector/tabs at the top (where you see annotator names like `farishs@bu.edu`)
   * Click the outsider’s annotation so it becomes the one displayed in the editor.

**Expected**

* You can switch between annotations and the editor updates accordingly.
* You see a **review status badge** for the currently selected annotation.
* You see **Approve** and **Reject** buttons beside **Update** in the bottom bar.

Take screenshot of bottom bar showing controls and status badge.

---

### C2 — Approve the annotation

1. Confirm you are viewing the outsider’s annotation (not your own, not a prediction).
2. Click **Approve**.

**Expected immediately**

* Badge changes to **Approved**.
* Tooltip (if implemented) shows “Approved by <your email>”.
* Buttons remain usable (no page reload needed).

**Persistence check**
3. Refresh the page.
4. Confirm the same annotation is still selected.
5. Confirm badge still shows **Approved**.

Record:

* Screenshot before/after approve
* Any delays or UI oddities

---

### C3 — Reject the annotation

Now test reject behavior on a second annotation (or the same one, if toggling is allowed).

1. Select a different outsider annotation (or keep same).
2. Click **Reject**.

**Expected**

* Badge changes to **Rejected**
* After refresh, badge remains **Rejected**

Record screenshots.

---

## D) Critical workflow: labeler edits after approval → auto reset

This is the most important “quality gate” behavior.

### D1 — Reviewer approves an annotation

1. As Reviewer, select outsider annotation.
2. Click **Approve**.
3. Confirm badge shows Approved.
4. Leave this task open for now.

---

### D2 — Labeler makes a small edit and saves

1. Login as **Labeler** (in a different browser/session if possible).
2. Open the same task.
3. Make a small visible edit:

   * Move a keypoint slightly
   * Add/remove a tiny polygon point
   * Modify brush stroke
4. Click **Update**.
5. Refresh.

**Expected**

* Labeler still cannot approve/reject.
* The annotation is saved.

---

### D3 — Reviewer verifies approval reset happened

1. Switch back to **Reviewer** session.
2. Refresh the task view.
3. Ensure you are looking at the same outsider annotation again.

**Expected**

* Badge now shows **Unreviewed** (approval cleared)
* It is not still marked Approved/Rejeted

Record:

* Screenshot showing it reset

---

## E) Security sanity: outsider cannot approve even via API

This prevents “clever labeler with curl” scenarios.

### E1 — Attempt approval as labeler

1. Login as labeler.
2. Attempt to call the approve endpoint for an annotation ID:

   * Use devtools network (if endpoint is discoverable) or a prepared curl command from engineering.

**Expected**

* Server returns **403 Forbidden**
* Reviewer refresh still shows Unreviewed (no unauthorized approval)

Record:

* HTTP status code + screenshot/log if possible

---

## F) Data filtering validation (dataset builder readiness)

You said filtering later is key. This step proves the signal is where you need it.

### F1 — Export project (or fetch via API)

1. Export annotations/tasks using your normal pipeline method (UI export or API).
2. Locate one annotation you Approved and one you did not.

**Expected**

* Approved annotation includes a review signal:

  * `last_action == "accepted"` (or equivalent)
  * reviewer identity present (`last_created_by.email` or similar)
* Unreviewed annotation does not show accepted/rejected.

### F2 — Demonstrate filtering rule (write this down in UAT notes)

Your dataset builder should be able to do:

* “Include only annotations where `last_action == accepted`.”

Record:

* a snippet of exported JSON showing those fields

---

## G) Reviewer “speed check” (real-world usability)

### G1 — Review 10 annotations quickly

1. Reviewer opens 10 different tasks with outsider annotations.
2. For each:

   * select outsider annotation
   * click Approve
   * move to next task

**Expected**

* No annoying modal flows
* Buttons always in the same place
* Badge updates instantly
* No accidental approving of the wrong annotation when switching tabs

Record:

* Any UI friction
* Any confusion about “which annotation am I approving?”

---

## Common failure modes to watch for (call these out if they occur)

* Approve/Reject applies to the wrong annotation when multiple exist
* Approval remains “Approved” even after labeler edits (stale approval bug)
* Labelers can see (or invoke) approve
* Badge does not persist after refresh
* UI requires refresh to update after clicking approve/reject
* Export does not include the approval signal in a consistent place

---

## UAT signoff criteria

UAT passes when:

* Reviewers can approve/reject **per annotation** from the bottom bar
* Outsiders cannot approve (UI + API)
* Status persists and is visible
* Edits reset approval
* Export/API supports filtering for dataset building

---

If you want, I can also rewrite the walkthrough in a “single narrative run” style (like a lab manual) with exact example values (Task 24292, Annotation 8232) so testers can literally follow it line-by-line using your real project IDs.

