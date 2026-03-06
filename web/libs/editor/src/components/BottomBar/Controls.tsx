/**
 * This panel is used with FF_1170 + FF_3873 in new interface,
 * but it's also used in old interface with FF_3873, but without FF_1170.
 * Only this component should get interface updates, other versions should be removed.
 */

import { observer } from "mobx-react";
import type React from "react";
import { useCallback, useState } from "react";

import { Button, ButtonGroup, type ButtonProps } from "@humansignal/ui";
import { IconBan, IconChevronDown } from "@humansignal/icons";
import { Dropdown } from "@humansignal/ui";
import type { CustomButtonType } from "../../stores/CustomButton";
import { cn } from "../../utils/bem";
import { FF_REVIEWER_FLOW, isFF } from "../../utils/feature-flags";
import { isDefined, toArray } from "../../utils/utilities";
import {
  AcceptButton,
  ButtonTooltip,
  controlsInjector,
  RejectButtonDefinition,
  SkipButton,
  UnskipButton,
} from "./buttons";

import "./Controls.scss";

// these buttons can be reused inside custom buttons or can be replaces with custom buttons
type SupportedInternalButtons = "accept" | "reject";
// special places for custom buttons — before, after or instead of internal buttons
type SpecialPlaces = "_before" | "_after" | "_replace";
// @todo should be Instance<typeof AppStore>["customButtons"] but it doesn't fit to itself
type CustomButtonsField = Map<
  SpecialPlaces | SupportedInternalButtons,
  CustomButtonType | SupportedInternalButtons | Array<CustomButtonType | SupportedInternalButtons>
>;
type ControlButtonProps = {
  button: CustomButtonType;
  disabled: boolean;
  variant?: ButtonProps["variant"];
  look?: ButtonProps["look"];
  onClick: (e: React.MouseEvent) => void;
};

export const EMPTY_SUBMIT_TOOLTIP = "Empty annotations denied in this project";

/**
 * Custom action button component, rendering buttons from store.customButtons
 */
const ControlButton = observer(({ button, disabled, onClick, variant, look }: ControlButtonProps) => {
  return (
    <Button
      {...button.props}
      variant={button.variant ?? variant}
      look={button.look ?? look}
      tooltip={button.tooltip}
      className="w-[150px]"
      aria-label={button.ariaLabel}
      disabled={button.disabled || disabled}
      onClick={onClick}
      data-testid={`bottombar-custom-${button.name}-button`}
    >
      {button.title}
    </Button>
  );
});

export const Controls = controlsInjector<{ annotation: MSTAnnotation }>(
  observer(({ store, history, annotation }) => {
    const isReview = store.hasInterface("review") || annotation.canBeReviewed;
    const isNotQuickView = store.hasInterface("topbar:prevnext");
    const historySelected = isDefined(store.annotationStore.selectedHistory);
    const { userGenerate, sentUserGenerate, versions, results, editable: annotationEditable } = annotation;
    const dropdownTrigger = cn("dropdown").elem("trigger").toClassName();
    const customButtons: CustomButtonsField = store.customButtons;
    const buttons: React.ReactNode[] = [];

    const [isInProgress, setIsInProgress] = useState(false);
    const disabled = !annotationEditable || store.isSubmitting || historySelected || isInProgress;
    const submitDisabled = store.hasInterface("annotations:deny-empty") && results.length === 0;

    /** Check all things related to comments and then call the action if all is good */
    const handleActionWithComments = useCallback(
      async (e: React.MouseEvent, callback: () => any, errorMessage: string) => {
        const { addedCommentThisSession, currentComment, commentFormSubmit } = store.commentStore;
        const comment = currentComment[annotation.id];
        // accept both old and new comment formats
        const commentText = (comment?.text ?? comment)?.trim();

        if (isInProgress) return;
        setIsInProgress(true);

        const selected = store.annotationStore?.selected;

        if (addedCommentThisSession) {
          selected?.submissionInProgress();
          callback();
        } else if (commentText) {
          e.preventDefault();
          selected?.submissionInProgress();
          await commentFormSubmit();
          callback();
        } else {
          store.commentStore.setTooltipMessage(errorMessage);
        }
        setIsInProgress(false);
      },
      [
        store.rejectAnnotation,
        store.skipTask,
        store.commentStore.currentComment,
        store.commentStore.commentFormSubmit,
        store.commentStore.addedCommentThisSession,
        isInProgress,
      ],
    );

    if (annotation.isNonEditableDraft) return <></>;

    const buttonsBefore = customButtons.get("_before");
    const buttonsReplacement = customButtons.get("_replace");
    const firstToRender = buttonsReplacement ?? buttonsBefore;

    // either we render _before buttons and then the rest, or we render only _replace buttons
    if (firstToRender) {
      const allButtons = toArray(firstToRender);
      for (const customButton of allButtons) {
        // @todo make a list of all internal buttons and use them here to mix custom buttons with internal ones
        // string buttons is a way to render internal buttons
        if (typeof customButton === "string") {
          if (customButton === "accept") {
            // just an example of internal button usage
            // @todo move buttons to separate components
            buttons.push(<AcceptButton key={customButton} disabled={disabled} history={history} store={store} />);
          }
        } else {
          buttons.push(
            <ControlButton
              key={customButton.name}
              disabled={disabled}
              button={customButton}
              onClick={() => store.handleCustomButton?.(customButton)}
            />,
          );
        }
      }
    }

    if (buttonsReplacement) {
      return <div className={cn("controls").toClassName()}>{buttons}</div>;
    }

    // Review status badge
    if (isReview && annotation.pk) {
      const reviewStatus = (annotation as any).review_status;
      const lastAction = (annotation as any).last_action;
      const reviewerEmail = reviewStatus?.reviewer_email || "";

      let badgeIcon = "○";
      let badgeColor = "#9e9e9e";
      let badgeTooltip = "Unreviewed";

      if (lastAction === "accepted") {
        badgeIcon = "✓";
        badgeColor = "#4caf50";
        badgeTooltip = reviewerEmail ? `Approved by ${reviewerEmail}` : "Approved";
      } else if (lastAction === "rejected") {
        badgeIcon = "✗";
        badgeColor = "#f44336";
        badgeTooltip = reviewerEmail ? `Rejected by ${reviewerEmail}` : "Rejected";
      }

      buttons.push(
        <ButtonTooltip key="review-badge" title={badgeTooltip}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "28px",
              height: "28px",
              borderRadius: "4px",
              fontSize: "18px",
              fontWeight: 700,
              color: badgeColor,
              border: `2px solid ${badgeColor}`,
              userSelect: "none",
              lineHeight: 1,
            }}
            data-testid="review-status-badge"
          >
            {badgeIcon}
          </span>
        </ButtonTooltip>,
      );
    }

    if (isReview) {
      const customRejectButtons = toArray(customButtons.get("reject"));
      const hasCustomReject = customRejectButtons.length > 0;
      const originalRejectButton = RejectButtonDefinition;

      // @todo implement reuse of internal buttons later (they are set as strings)
      const rejectButtons: CustomButtonType[] = hasCustomReject
        ? customRejectButtons.filter((button) => typeof button !== "string")
        : [originalRejectButton];

      rejectButtons.forEach((button) => {
        const action = hasCustomReject ? () => store.handleCustomButton?.(button) : () => store.rejectAnnotation({});

        const onReject = async (e: React.MouseEvent) => {
          const selected = store.annotationStore?.selected;

          if (store.hasInterface("comments:reject")) {
            handleActionWithComments(e, action, "Please enter a comment before rejecting");
          } else {
            selected?.submissionInProgress();
            await store.commentStore.commentFormSubmit();
            action();
          }
        };

        buttons.push(
          <button
            key={button.name}
            title="Reject annotation: [ Ctrl+Space ]"
            aria-label="reject-annotation"
            disabled={disabled}
            onClick={onReject}
            data-testid="bottombar-reject-button"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "40px",
              height: "40px",
              padding: "0",
              border: "2px solid #f44336",
              borderRadius: "4px",
              backgroundColor: "transparent",
              color: "#f44336",
              fontSize: "22px",
              fontWeight: 700,
              cursor: disabled ? "not-allowed" : "pointer",
              opacity: disabled ? 0.4 : 1,
              lineHeight: 1,
            }}
          >
            ✗
          </button>,
        );
      });
      buttons.push(
        <button
          key="review-accept"
          title="Accept annotation: [ Ctrl+Enter ]"
          aria-label="accept-annotation"
          disabled={disabled}
          onClick={async () => {
            const selected = store.annotationStore.selected;

            selected?.submissionInProgress();
            await store.commentStore.commentFormSubmit();
            store.acceptAnnotation();
          }}
          data-testid="bottombar-accept-button"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "40px",
            height: "40px",
            padding: "0",
            border: "2px solid #4caf50",
            borderRadius: "4px",
            backgroundColor: "#4caf50",
            color: "#fff",
            fontSize: "22px",
            fontWeight: 700,
            cursor: disabled ? "not-allowed" : "pointer",
            opacity: disabled ? 0.4 : 1,
            lineHeight: 1,
          }}
        >
          ✓
        </button>,
      );
    } else if (annotation.skipped) {
      buttons.push(
        <div className={cn("controls").elem("skipped-info").toClassName()} key="skipped">
          <IconBan /> Was skipped
        </div>,
      );
      buttons.push(<UnskipButton key="unskip" disabled={disabled} store={store} />);
    } else {
      if (store.hasInterface("skip")) {
        const onSkipWithComment = (e: React.MouseEvent, action: () => any) => {
          handleActionWithComments(e, action, "Please enter a comment before skipping");
        };

        buttons.push(<SkipButton key="skip" disabled={disabled} store={store} onSkipWithComment={onSkipWithComment} />);
      }

      const isDisabled = disabled || submitDisabled;

      const useExitOption = !isDisabled && isNotQuickView;

      const SubmitOption = ({
        isUpdate,
        onClickMethod,
      }: {
        isUpdate: boolean;
        onClickMethod: () => any;
      }) => {
        return (
          <div className="p-tighter rounded">
            <Button
              name="submit-option"
              look="string"
              size="small"
              className="w-[150px]"
              onClick={async (event) => {
                event.preventDefault();

                const selected = store.annotationStore?.selected;

                selected?.submissionInProgress();

                if ("URLSearchParams" in window) {
                  const searchParams = new URLSearchParams(window.location.search);

                  searchParams.set("exitStream", "true");
                  const newRelativePathQuery = `${window.location.pathname}?${searchParams.toString()}`;

                  window.history.pushState(null, "", newRelativePathQuery);
                }

                await store.commentStore.commentFormSubmit();
                onClickMethod();
              }}
              data-testid={`bottombar-${isUpdate ? "update" : "submit"}-and-exit-button`}
            >
              {`${isUpdate ? "Update" : "Submit"} and exit`}
            </Button>
          </div>
        );
      };

      if (userGenerate || (store.explore && !userGenerate && store.hasInterface("submit"))) {
        const title = submitDisabled ? EMPTY_SUBMIT_TOOLTIP : "Save results: [ Ctrl+Enter ]";

        buttons.push(
          <ButtonTooltip key="submit" title={title}>
            <div className={cn("controls").elem("tooltip-wrapper").toClassName()}>
              <ButtonGroup>
                <Button
                  aria-label="Submit current annotation"
                  name="submit"
                  className="w-[150px]"
                  disabled={isDisabled}
                  onClick={async (event) => {
                    if ((event.target as HTMLButtonElement).classList.contains(dropdownTrigger)) return;
                    const selected = store.annotationStore?.selected;

                    selected?.submissionInProgress();
                    await store.commentStore.commentFormSubmit();
                    store.submitAnnotation();
                  }}
                  data-testid="bottombar-submit-button"
                >
                  Submit
                </Button>
                {useExitOption ? (
                  <Dropdown.Trigger
                    alignment="top-right"
                    content={
                      <div className="p-tight bg-neutral-surface">
                        <SubmitOption onClickMethod={store.submitAnnotation} isUpdate={false} />
                      </div>
                    }
                  >
                    <Button
                      disabled={isDisabled}
                      aria-label="Submit annotation"
                      data-testid="bottombar-submit-dropdown"
                    >
                      <IconChevronDown />
                    </Button>
                  </Dropdown.Trigger>
                ) : null}
              </ButtonGroup>
            </div>
          </ButtonTooltip>,
        );
      } else if ((userGenerate && sentUserGenerate) || (!userGenerate && store.hasInterface("update"))) {
        const isUpdate = Boolean(isFF(FF_REVIEWER_FLOW) || sentUserGenerate || versions.result);
        // no changes were made over previously submitted version — no drafts, no pending changes
        const noChanges = isFF(FF_REVIEWER_FLOW) && !history.canUndo && !annotation.draftId;
        const isUpdateDisabled = isDisabled || noChanges;
        const button = (
          <ButtonTooltip key="update" title={noChanges ? "No changes were made" : "Update this task: [ Ctrl+Enter ]"}>
            <ButtonGroup>
              <Button
                aria-label="submit"
                name="submit"
                className="w-[150px]"
                disabled={isUpdateDisabled}
                onClick={async (event) => {
                  if ((event.target as HTMLButtonElement).classList.contains(dropdownTrigger)) return;
                  const selected = store.annotationStore?.selected;

                  selected?.submissionInProgress();
                  await store.commentStore.commentFormSubmit();
                  store.updateAnnotation();
                }}
                data-testid="bottombar-update-button"
              >
                {isUpdate ? "Update" : "Submit"}
              </Button>
              {useExitOption ? (
                <Dropdown.Trigger
                  alignment="top-right"
                  content={<SubmitOption onClickMethod={store.updateAnnotation} isUpdate={isUpdate} />}
                >
                  <Button
                    disabled={isUpdateDisabled}
                    aria-label="Update annotation"
                    data-testid="bottombar-update-dropdown"
                  >
                    <IconChevronDown />
                  </Button>
                </Dropdown.Trigger>
              ) : null}
            </ButtonGroup>
          </ButtonTooltip>
        );

        buttons.push(button);
      }
    }

    return <div className={cn("controls").toClassName()}>{buttons}</div>;
  }),
);
