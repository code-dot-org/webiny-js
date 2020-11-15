// @ts-nocheck
import { ErrorResponse } from "@webiny/commodo-graphql";
import { Context } from "@webiny/graphql/types";

type SettingsContext = Context;

export default {
    name: "graphql-schema-settings-page-builder",
    type: "graphql-schema",
    typeDefs: /* GraphQL */ `
        type PbSettingsError {
            code: String
            message: String
            data: JSON
        }

        type PbSocialMedia {
            facebook: String
            twitter: String
            instagram: String
            image: File
        }

        type PbSettings {
            name: String
            favicon: File
            logo: File
            domain: String
            social: PbSocialMedia
            pages: PbSettingsPages
        }

        type PbSettingsResponse {
            error: PbSettingsError
            id: ID
            data: PbSettings
        }

        type PbSettingsPages {
            home: ID
            notFound: ID
            error: ID
        }

        type PbDefaultPage {
            id: String
            parent: String
            title: String
        }

        input PbSocialMediaInput {
            facebook: String
            twitter: String
            instagram: String
            image: RefInput
        }

        input PbDefaultPageInput {
            id: String
            title: String
        }

        input PbSettingsInput {
            name: String
            domain: String
            favicon: RefInput
            logo: RefInput
            social: PbSocialMediaInput
            pages: PbSettingsPagesInput
        }

        input PbSettingsPagesInput {
            home: ID
            notFound: ID
            error: ID
        }

        extend type PbQuery {
            getSettings: PbSettingsResponse
        }

        extend type PbMutation {
            updateSettings(data: PbSettingsInput): PbSettingsResponse
        }
    `,
    resolvers: {
        PbQuery: {
            getSettings: async (_, args, context: SettingsContext) => {
                try {
                    const data = await context.settingsManager.getSettings("page-builder");
                    return { data };
                } catch (err) {
                    return new ErrorResponse(err);
                }
            }
        },
        PbMutation: {
            /*updateSettings: resolveUpdateSettings(ctx => ctx.models.PbSettings)*/
        }
    }
};
