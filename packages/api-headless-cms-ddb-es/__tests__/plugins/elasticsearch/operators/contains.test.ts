import { elasticsearchOperatorContainsPlugin } from "../../../../src/elasticsearch/operators/contains";
import { createBlankQuery } from "../helpers";
import { ElasticsearchQuery } from "@webiny/api-plugin-elastic-search-client/types";

describe("elasticsearchOperatorContainsPlugin", () => {
    const plugin = elasticsearchOperatorContainsPlugin();
    const context: any = {};

    it("should apply contains correctly", () => {
        const query = createBlankQuery();

        plugin.apply(query, {
            field: "name",
            value: "John",
            context
        });

        plugin.apply(query, {
            field: "name",
            value: "Doe",
            context
        });

        const expected: ElasticsearchQuery = {
            mustNot: [],
            must: [
                {
                    query_string: {
                        allow_leading_wildcard: true,
                        // @ts-ignore
                        default_operator: "AND",
                        fields: ["name"],
                        query: "*John*"
                    }
                },
                {
                    query_string: {
                        allow_leading_wildcard: true,
                        // @ts-ignore
                        default_operator: "AND",
                        fields: ["name"],
                        query: "*Doe*"
                    }
                }
            ],

            should: []
        };
        expect(query).toEqual(expected);
    });
});
