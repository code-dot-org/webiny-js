const execa = require("execa");
const chalk = require("chalk");
const localtunnel = require("localtunnel");
const express = require("express");
const bodyParser = require("body-parser");
const { login, getPulumi, loadEnvVariables, getRandomColorForString } = require("../utils");
const { getProjectApplication } = require("@webiny/cli/utils");
const path = require("path");
const get = require("lodash/get");
const merge = require("lodash/merge");
const browserOutput = require("./watch/output/browserOutput");
const terminalOutput = require("./watch/output/terminalOutput");
const minimatch = require("minimatch");

const SECRETS_PROVIDER = process.env.PULUMI_SECRETS_PROVIDER;

module.exports = async (inputs, context) => {
    let projectApplication;
    if (inputs.folder) {
        // Get project application metadata.
        projectApplication = getProjectApplication({
            cwd: path.join(process.cwd(), inputs.folder)
        });

        // If exists - read default inputs from "webiny.application.js" file.
        inputs = merge({}, get(projectApplication, "config.cli.watch"), inputs);
    }

    inputs.build = inputs.build !== false;
    inputs.deploy = Boolean(projectApplication && inputs.deploy !== false);

    if (inputs.deploy && !inputs.env) {
        throw new Error(`Please specify environment, for example "dev".`);
    }

    if (inputs.deploy) {
        if (typeof inputs.logs === "string" && inputs.logs === "") {
            inputs.logs = "*";
        }
    }

    // 1. Initial checks for deploy and build commands.
    if (!inputs.build && !inputs.deploy) {
        throw new Error(`Both re-build and re-deploy actions were disabled, can't continue.`);
    }

    if (!inputs.folder && !inputs.scope) {
        throw new Error(
            `Either "folder" or "scope" arguments must be passed. Cannot have both undefined.`
        );
    }

    // 1.1. Check if the project application and Pulumi stack exist.
    if (inputs.deploy) {
        await loadEnvVariables(inputs, context);

        const { env } = inputs;

        await login(projectApplication);

        const pulumi = await getPulumi({
            execa: {
                cwd: projectApplication.root
            }
        });

        let stackExists = true;
        try {
            await pulumi.run(
                { command: ["stack", "select", env] },
                {
                    args: {
                        secretsProvider: SECRETS_PROVIDER
                    }
                }
            );
        } catch (e) {
            stackExists = false;
        }

        if (!stackExists) {
            throw new Error(`Please specify an existing environment, for example "dev".`);
        }
    }

    let output = inputs.output === "browser" ? browserOutput : terminalOutput;
    await output.initialize(inputs);

    try {
        const logging = {
            url: null
        };

        // Forward logs from the cloud to here, using the "localtunnel" library.
        if (inputs.logs) {
            const tunnel = await localtunnel({ port: 3010 });

            logging.url = tunnel.url;

            const app = express();
            app.use(bodyParser.urlencoded({ extended: false }));
            app.use(bodyParser.json());

            app.post("/", (req, res) => {
                if (Array.isArray(req.body)) {
                    req.body.forEach(consoleLog => {
                        printLog({
                            output,
                            consoleLog,
                            pattern: inputs.logs
                        });
                    });
                }
                res.send("Message received.");
            });

            app.listen(3010);

            [
                chalk.green(`Listening for incoming logs on port 3010...`),
                `Note: everything you log in your code will be forwarded here ${chalk.underline(
                    "over public internet"
                )}.`,
                `To learn more, please visit https://www.webiny.com/docs/todo-article.`
            ].forEach(message => output.log({ type: "logs", message }));

            output.log({ type: "logs", message: "" });

            if (inputs.logs !== "*") {
                output.log({
                    type: "logs",
                    message: chalk.gray(
                        `Only showing logs that match the following pattern: ${inputs.logs}`
                    )
                });
            }
        }

        // Add deploy logs.
        if (inputs.deploy) {
            output.log({
                type: "deploy",
                message: chalk.green("Watching cloud infrastructure resources...")
            });

            const pulumi = await getPulumi({
                execa: {
                    cwd: projectApplication.root
                }
            });

            const watchCloudInfrastructure = pulumi.run({
                command: "watch",
                args: {
                    secretsProvider: SECRETS_PROVIDER,
                    color: "always"
                },
                execa: {
                    env: {
                        WEBINY_ENV: inputs.env,
                        WEBINY_PROJECT_NAME: context.projectName,
                        WEBINY_LOGS_FORWARD_URL: logging.url
                    }
                }
            });

            watchCloudInfrastructure.stdout.on("data", data => {
                output.log({
                    type: "deploy",
                    message: data.toString()
                });
            });

            watchCloudInfrastructure.stderr.on("data", data => {
                output.log({
                    type: "deploy",
                    message: data.toString()
                });
            });

            // If logs are enabled, inform user that we're updating the WEBINY_LOGS_FORWARD_URL env variable.
            if (inputs.logs) {
                setTimeout(() => {
                    output.log({
                        type: "deploy",
                        message: `Logs enabled - updating ${chalk.gray(
                            "WEBINY_LOGS_FORWARD_URL"
                        )} environment variable...`
                    });
                }, 3000);
            }
        }

        // Add build logs.
        if (inputs.build) {
            output.log({
                type: "build",
                message: chalk.green("Watching packages...")
            });

            let scopes = [];
            if (inputs.scope) {
                scopes = Array.isArray(inputs.scope) ? inputs.scope : [inputs.scope];
            } else {
                scopes = await execa("yarn", [
                    "webiny",
                    "workspaces",
                    "tree",
                    "--json",
                    "--depth",
                    inputs.depth,
                    "--distinct",
                    "--folder",
                    inputs.folder
                ]).then(({ stdout }) => JSON.parse(stdout));
            }

            const watchPackages = execa(
                "yarn",
                [
                    "webiny",
                    "workspaces",
                    "run",
                    "watch",
                    "--env",
                    inputs.env,
                    ...scopes.reduce((current, item) => {
                        current.push("--scope", item);
                        return current;
                    }, [])
                ],
                { env: { FORCE_COLOR: true } }
            );

            watchPackages.stdout.on("data", data => {
                output.log({
                    type: "build",
                    message: data.toString()
                });
            });

            watchPackages.stderr.on("data", data => {
                output.log({
                    type: "build",
                    message: data.toString()
                });
            });
        }
    } catch (e) {
        output.error(e);
        throw e;
    }
};

const printLog = ({ pattern = "*", consoleLog, output }) => {
    const plainPrefix = `${consoleLog.meta.functionName}:`;
    let message = consoleLog.args.join(" ").trim();
    if (message) {
        if (minimatch(plainPrefix, pattern)) {
            const coloredPrefix = chalk.hex(getRandomColorForString(plainPrefix)).bold(plainPrefix);
            output.log({
                type: "logs",
                message: coloredPrefix + message
            });
        }
    }
};
