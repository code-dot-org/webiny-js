/**
 * For more information on the API project application, please see:
 * https://www.webiny.com/docs/key-topics/cloud-infrastructure/api/introduction
 */
module.exports = {
    id: "api",
    name: "API",
    description: "Your GraphQL API and all of the backend services.",
    cli: {
        // Default args for the "yarn webiny watch ..." command (we don't need deploy option while developing).
        watch: {
            // Watch five levels of dependencies, starting from this project application.
            depth: 5
        }
    }
};
