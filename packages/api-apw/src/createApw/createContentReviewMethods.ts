import get from "lodash/get";
import { createTopic } from "@webiny/pubsub";
import Error from "@webiny/error";
import {
    AdvancedPublishingWorkflow,
    ApwContentReview,
    ApwContentReviewCrud,
    ApwContentReviewStatus,
    ApwContentReviewStep,
    ApwContentReviewStepStatus,
    ApwContentTypes,
    ApwReviewerCrud,
    ApwWorkflowStepTypes,
    CreateApwParams,
    OnAfterContentReviewCreateTopicParams,
    OnAfterContentReviewDeleteTopicParams,
    OnAfterContentReviewUpdateTopicParams,
    OnBeforeContentReviewCreateTopicParams,
    OnBeforeContentReviewDeleteTopicParams,
    OnBeforeContentReviewUpdateTopicParams
} from "~/types";
import { getNextStepStatus, hasReviewer } from "~/plugins/utils";
import {
    NoSignOffProvidedError,
    NotAuthorizedError,
    PendingChangeRequestsError,
    StepInActiveError,
    StepMissingError
} from "~/utils/errors";

interface CreateContentReviewMethodsParams extends CreateApwParams {
    getReviewer: ApwReviewerCrud["get"];
    getContentGetter: AdvancedPublishingWorkflow["getContentGetter"];
    getContentPublisher: AdvancedPublishingWorkflow["getContentPublisher"];
    getContentUnPublisher: AdvancedPublishingWorkflow["getContentUnPublisher"];
}

export function createContentReviewMethods({
    getIdentity,
    storageOperations,
    getReviewer,
    getContentGetter,
    getContentPublisher,
    getContentUnPublisher
}: CreateContentReviewMethodsParams): ApwContentReviewCrud {
    const onBeforeContentReviewCreate = createTopic<OnBeforeContentReviewCreateTopicParams>();
    const onAfterContentReviewCreate = createTopic<OnAfterContentReviewCreateTopicParams>();
    const onBeforeContentReviewUpdate = createTopic<OnBeforeContentReviewUpdateTopicParams>();
    const onAfterContentReviewUpdate = createTopic<OnAfterContentReviewUpdateTopicParams>();
    const onBeforeContentReviewDelete = createTopic<OnBeforeContentReviewDeleteTopicParams>();
    const onAfterContentReviewDelete = createTopic<OnAfterContentReviewDeleteTopicParams>();
    return {
        /**
         * Lifecycle events
         */
        onBeforeContentReviewCreate,
        onAfterContentReviewCreate,
        onBeforeContentReviewUpdate,
        onAfterContentReviewUpdate,
        onBeforeContentReviewDelete,
        onAfterContentReviewDelete,
        async get(id) {
            return storageOperations.getContentReview({ id });
        },
        async list(params) {
            return storageOperations.listContentReviews(params);
        },
        async create(data) {
            const input = {
                ...data,
                status: ApwContentReviewStatus.UNDER_REVIEW
            };
            await onBeforeContentReviewCreate.publish({ input });

            const contentReview = await storageOperations.createContentReview({
                data: input
            });

            await onAfterContentReviewCreate.publish({ contentReview });

            return contentReview;
        },
        async update(id, data) {
            const original = await storageOperations.getContentReview({ id });

            await onBeforeContentReviewUpdate.publish({ original, input: { id, data } });

            const contentReview = await storageOperations.updateContentReview({
                id,
                data
            });

            await onAfterContentReviewUpdate.publish({
                original,
                input: { id, data },
                contentReview
            });

            return contentReview;
        },
        async delete(id) {
            const contentReview = await storageOperations.getContentReview({ id });

            await onBeforeContentReviewDelete.publish({ contentReview });

            await storageOperations.deleteContentReview({ id });

            await onAfterContentReviewDelete.publish({ contentReview });

            return true;
        },
        async provideSignOff(this: ApwContentReviewCrud, id, stepId) {
            const entry: ApwContentReview = await this.get(id);
            const { steps, status } = entry;
            const stepIndex = steps.findIndex(step => step.id === stepId);
            const currentStep = steps[stepIndex];
            const previousStep = steps[stepIndex - 1];

            const identity = getIdentity();
            const hasPermission = await hasReviewer({
                getReviewer,
                identity,
                step: currentStep
            });

            /**
             *  Check whether the sign-off is requested by a reviewer.
             */
            if (!hasPermission) {
                throw new NotAuthorizedError({ entry, input: { id, step: stepId } });
            }
            /**
             *  Don't allow sign off, if previous step is of "mandatory_blocking" type and undone.
             */
            if (
                previousStep &&
                previousStep.status !== ApwContentReviewStepStatus.DONE &&
                previousStep.type === ApwWorkflowStepTypes.MANDATORY_BLOCKING
            ) {
                throw new StepMissingError({ entry, input: { id, step: stepId } });
            }
            /**
             *  Don't allow sign off, if there are pending change requests.
             */
            if (currentStep.pendingChangeRequests > 0) {
                throw new PendingChangeRequestsError({ entry, input: { id, step: stepId } });
            }
            /**
             *  Don't allow sign off, if current step is not in "active" state.
             */
            if (currentStep.status !== ApwContentReviewStepStatus.ACTIVE) {
                throw new StepInActiveError({ entry, input: { id, step: stepId } });
            }
            let previousStepStatus: ApwContentReviewStepStatus;
            /*
             * Provide sign-off for give step.
             */
            const updatedSteps = steps.map((step, index) => {
                if (index === stepIndex) {
                    previousStepStatus = ApwContentReviewStepStatus.DONE;
                    return {
                        ...step,
                        status: ApwContentReviewStepStatus.DONE,
                        signOffProvidedOn: new Date().toISOString(),
                        signOffProvidedBy: identity
                    };
                }
                /**
                 * Update next steps status based on type.
                 */
                if (index > stepIndex) {
                    const previousStep = steps[index - 1];

                    previousStepStatus = getNextStepStatus(previousStep.type, previousStepStatus);
                    return {
                        ...step,
                        status: previousStepStatus
                    };
                }

                return step;
            });
            /**
             * Check for pending steps
             */
            let newStatus = status;
            const pendingRequiredSteps = getPendingRequiredSteps(
                updatedSteps,
                step => typeof step.signOffProvidedOn !== "string"
            );

            /**
             * If there are no required steps that are pending, set the status to "READY_TO_BE_PUBLISHED".
             */
            if (pendingRequiredSteps.length === 0) {
                newStatus = ApwContentReviewStatus.READY_TO_BE_PUBLISHED;
            }

            /**
             * Save updated steps.
             */
            await this.update(id, {
                steps: updatedSteps,
                status: newStatus
            });
            return true;
        },
        async retractSignOff(this: ApwContentReviewCrud, id, stepId) {
            const entry: ApwContentReview = await this.get(id);
            const { steps, status } = entry;
            const stepIndex = steps.findIndex(step => step.id === stepId);
            const currentStep = steps[stepIndex];

            const identity = getIdentity();

            const hasPermission = await hasReviewer({
                getReviewer,
                identity,
                step: currentStep
            });

            /**
             *  Check whether the retract sign-off is requested by a reviewer.
             */
            if (!hasPermission) {
                throw new NotAuthorizedError({ entry, input: { id, step: stepId } });
            }
            /**
             *  Don't allow, if step in not "done" i.e. no sign-off was provided for it.
             */
            if (currentStep.status !== ApwContentReviewStepStatus.DONE) {
                throw new NoSignOffProvidedError({ entry, input: { id, step: stepId } });
            }
            let previousStepStatus: ApwContentReviewStepStatus;

            /*
             * Retract sign-off for give step.
             */
            const updatedSteps = steps.map((step, index) => {
                if (index === stepIndex) {
                    previousStepStatus = ApwContentReviewStepStatus.ACTIVE;
                    return {
                        ...step,
                        status: previousStepStatus,
                        signOffProvidedOn: null,
                        signOffProvidedBy: null
                    };
                }
                /**
                 * Set next step status as "inactive".
                 */
                if (index > stepIndex) {
                    const previousStep = steps[index - 1];

                    previousStepStatus = getNextStepStatus(previousStep.type, previousStepStatus);

                    return {
                        ...step,
                        status: previousStepStatus
                    };
                }

                return step;
            });

            /**
             * Check for pending steps
             */
            let newStatus = status;
            const pendingRequiredSteps = getPendingRequiredSteps(
                updatedSteps,
                step => step.signOffProvidedOn === null
            );
            /**
             * If there are required steps that are pending, set the status to "UNDER_REVIEW".
             */
            if (pendingRequiredSteps.length !== 0) {
                newStatus = ApwContentReviewStatus.UNDER_REVIEW;
            }

            await this.update(id, {
                steps: updatedSteps,
                status: newStatus
            });
            return true;
        },
        async isReviewRequired(data) {
            const contentGetter = getContentGetter(data.type);
            const content = await contentGetter(data.id, data.settings);

            let isReviewRequired = false;
            let contentReviewId = null;

            if (data.type === ApwContentTypes.PAGE) {
                contentReviewId = get(content, "settings.apw.contentReviewId");

                const workflowId = get(content, "settings.apw.workflowId");

                if (workflowId) {
                    isReviewRequired = true;
                }
            }
            return {
                isReviewRequired,
                contentReviewId
            };
        },
        async publishContent(this: ApwContentReviewCrud, id: string) {
            const { content, status } = await this.get(id);

            if (status !== ApwContentReviewStatus.READY_TO_BE_PUBLISHED) {
                throw new Error({
                    message: `Cannot publish content because it is not yet ready to be published.`,
                    code: "NOT_READY_TO_BE_PUBLISHED",
                    data: {
                        id,
                        status,
                        content
                    }
                });
            }

            const contentPublisher = getContentPublisher(content.type);

            await contentPublisher(content.id, content.settings);

            await this.update(id, { status: ApwContentReviewStatus.PUBLISHED });

            return true;
        },
        async unpublishContent(this: ApwContentReviewCrud, id: string) {
            const { content, status } = await this.get(id);

            if (status !== ApwContentReviewStatus.PUBLISHED) {
                throw new Error({
                    message: `Cannot unpublish content because it is not yet published.`,
                    code: "NOT_YET_PUBLISHED",
                    data: {
                        id,
                        status,
                        content
                    }
                });
            }

            const contentUnPublisher = getContentUnPublisher(content.type);

            await contentUnPublisher(content.id, content.settings);

            await this.update(id, { status: ApwContentReviewStatus.READY_TO_BE_PUBLISHED });

            return true;
        }
    };
}

interface GetPendingRequiredSteps {
    (
        steps: ApwContentReviewStep[],
        predicate: (step: ApwContentReviewStep) => boolean
    ): ApwContentReviewStep[];
}

const getPendingRequiredSteps: GetPendingRequiredSteps = (steps, predicate) => {
    return steps.filter(step => {
        const isRequiredStep = [
            ApwWorkflowStepTypes.MANDATORY_BLOCKING,
            ApwWorkflowStepTypes.MANDATORY_NON_BLOCKING
        ].includes(step.type);

        if (!isRequiredStep) {
            return false;
        }

        return predicate(step);
    });
};
