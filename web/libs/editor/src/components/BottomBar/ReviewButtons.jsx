import { observer } from "mobx-react";

/**
 * Standalone review/approval buttons for the Glidance review workflow.
 * Renders badge + reject + accept inline in the toolbar area,
 * independent of the upstream Controls.tsx review flow.
 */
export const ReviewButtons = observer(({ store }) => {
  const settings = window.APP_SETTINGS?.review;

  // If review feature is off entirely, render nothing
  if (!settings?.enabled) return null;

  const canReview = settings?.can_review;
  const annotation = store.annotationStore?.selected;

  if (!annotation?.pk) return null;

  // Prevent self-review: hide ✓/✗ buttons when viewing own annotation
  const currentUserEmail = window.APP_SETTINGS?.user?.email;
  const annotationAuthorEmail = annotation?.user?.email;
  const isOwnAnnotation = currentUserEmail && annotationAuthorEmail &&
    currentUserEmail.toLowerCase() === annotationAuthorEmail.toLowerCase();

  const lastAction = annotation.last_action;
  const disabled = !annotation.editable || store.isSubmitting;
  const reviewInfo = annotation.review_status;

  let badgeIcon = "○";
  let badgeColor = "#9e9e9e";
  let badgeTitle = "Unreviewed";

  if (lastAction === "accepted" || lastAction === "fixed_and_accepted") {
    badgeIcon = "✓";
    badgeColor = "#4caf50";
    badgeTitle = reviewInfo?.reviewer_email
      ? `Approved by ${reviewInfo.reviewer_email}`
      : "Approved";
  } else if (lastAction === "rejected") {
    badgeIcon = "✗";
    badgeColor = "#f44336";
    badgeTitle = reviewInfo?.reviewer_email
      ? `Rejected by ${reviewInfo.reviewer_email}`
      : "Rejected";
  }

  const buttonBase = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "32px",
    height: "32px",
    padding: "0",
    borderRadius: "4px",
    fontSize: "18px",
    fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.4 : 1,
    lineHeight: 1,
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
      <span
        title={badgeTitle}
        style={{
          ...buttonBase,
          color: badgeColor,
          border: `2px solid ${badgeColor}`,
          backgroundColor: "transparent",
          cursor: "default",
          opacity: 1,
          width: "28px",
          height: "28px",
          fontSize: "16px",
          userSelect: "none",
        }}
        data-testid="review-status-badge"
      >
        {badgeIcon}
      </span>
      {canReview && !isOwnAnnotation && (
        <>
          <button
            title="Reject annotation"
            aria-label="reject-annotation"
            disabled={disabled}
            onClick={async () => {
              const selected = store.annotationStore?.selected;

              selected?.submissionInProgress();
              await store.commentStore?.commentFormSubmit();
              store.rejectAnnotation({});
            }}
            data-testid="bottombar-reject-button"
            style={{
              ...buttonBase,
              border: "2px solid #f44336",
              backgroundColor: "transparent",
              color: "#f44336",
            }}
          >
            ✗
          </button>
          <button
            title="Accept annotation"
            aria-label="accept-annotation"
            disabled={disabled}
            onClick={async () => {
              const selected = store.annotationStore?.selected;

              selected?.submissionInProgress();
              await store.commentStore?.commentFormSubmit();
              store.acceptAnnotation();
            }}
            data-testid="bottombar-accept-button"
            style={{
              ...buttonBase,
              border: "2px solid #4caf50",
              backgroundColor: "#4caf50",
              color: "#fff",
            }}
          >
            ✓
          </button>
        </>
      )}
    </div>
  );
});
