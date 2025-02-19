import React from "react";
import { CompositionScope, makeDecoratable } from "@webiny/react-composition";
import { AcoConfig, TableColumnConfig as ColumnConfig } from "@webiny/app-aco";
import { TableItem } from "~/types";
import { IsApplicableToCurrentModel } from "~/admin/config/IsApplicableToCurrentModel";

const { Table } = AcoConfig;

export { ColumnConfig };

export interface ColumnProps extends React.ComponentProps<typeof AcoConfig.Table.Column> {
    modelIds?: string[];
}

const BaseColumnComponent = ({ modelIds = [], ...props }: ColumnProps) => {
    return (
        <CompositionScope name={"cms"}>
            <AcoConfig>
                <IsApplicableToCurrentModel modelIds={modelIds}>
                    <Table.Column {...props} />
                </IsApplicableToCurrentModel>
            </AcoConfig>
        </CompositionScope>
    );
};

const BaseColumn = makeDecoratable("Column", BaseColumnComponent);

export const Column = Object.assign(BaseColumn, {
    useTableRow: Table.Column.createUseTableRow<TableItem>(),
    isFolderRow: Table.Column.isFolderRow
});
