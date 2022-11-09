interface Params {
    baseUrl?: string;
    contentReviewId: string;
    stepId: string;
}
export const createContentReviewUrl = (params: Params) => {
    /**
     * All variables must exist for URL to be created.
     * We go through all vars and throw a log if it does not exist.
     */
    for (const key in params) {
        if (!!key) {
            continue;
        }
        console.log(`Missing variable "${key}", which we use to create a comment URL.`);
        return null;
    }
    const { baseUrl, contentReviewId, stepId } = params;

    return `${baseUrl}/apw/content-reviews/${contentReviewId}/${stepId}`;
};
