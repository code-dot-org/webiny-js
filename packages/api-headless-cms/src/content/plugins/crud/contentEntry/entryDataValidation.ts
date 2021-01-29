import {
    CmsContentModel,
    CmsContentModelField,
    CmsContentModelFieldValidation,
    CmsContext,
    CmsModelFieldValidatorPlugin,
    CmsModelFieldValidatorValidateParams
} from "@webiny/api-headless-cms/types";
import WebinyError from "@webiny/error";

type PluginValidationCallable = (params: CmsModelFieldValidatorValidateParams) => Promise<boolean>;
type PluginValidationList = Record<string, PluginValidationCallable[]>;
type InputData = Record<string, any>;

interface ValidateArgs {
    validatorList: PluginValidationList;
    field: CmsContentModelField;
    data: InputData;
    context: CmsContext;
}

const validateValue = async (
    args: ValidateArgs,
    fieldValidators: CmsContentModelFieldValidation[],
    value: any
): Promise<string | null> => {
    const { validatorList, context } = args;
    try {
        for (const fieldValidator of fieldValidators) {
            const name = fieldValidator.name;
            const validations = validatorList[name];
            if (!validations || validations.length === 0) {
                return `There are no "${name}" validators defined.`;
            }
            for (const validate of validations) {
                const result = await validate({
                    value,
                    context,
                    validator: fieldValidator
                });
                if (!result) {
                    return fieldValidator.message;
                }
            }
        }
    } catch (ex) {
        return ex.message;
    }

    return null;
};
/**
 * When multiple values is selected we must run validations on the array containing the values
 * And then on each value in the array
 */
const runFieldMultipleValuesValidations = async (args: ValidateArgs): Promise<string | null> => {
    const { field, data } = args;
    const values = data[field.fieldId];
    if (Array.isArray(values) === false) {
        return `Value of the field "${field.fieldId}" is not an array.`;
    }
    const valuesError = await validateValue(args, field.listValidation || [], values);
    if (valuesError) {
        return valuesError;
    }
    for (const value of values) {
        const valueError = await validateValue(args, field.validation || [], value);
        if (valueError) {
            return valueError;
        }
    }
    return null;
};
/**
 * Runs validation on given value.
 */
const runFieldValueValidations = async (args: ValidateArgs): Promise<string | null> => {
    const { data, field } = args;
    const value = data[field.fieldId];
    return await validateValue(args, field.validation, value);
};

const execValidation = async (args: ValidateArgs): Promise<string | null> => {
    if (args.field.multipleValues) {
        return await runFieldMultipleValuesValidations(args);
    }
    return await runFieldValueValidations(args);
};

export const validateModelEntryData = async (
    context: CmsContext,
    contentModel: CmsContentModel,
    data: InputData
) => {
    /**
     * To later simplify searching for the validations we map them to a name.
     * @see CmsModelFieldValidatorPlugin.validator.validate
     */
    const validatorList: PluginValidationList = context.plugins
        .byType<CmsModelFieldValidatorPlugin>("cms-model-field-validator")
        .reduce((acc, plugin) => {
            const name = plugin.validator.name;
            if (!acc[name]) {
                acc[name] = [];
            }
            acc[name].push(plugin.validator.validate);

            return acc;
        }, {} as PluginValidationList);

    /**
     * Loop through model fields and validate the corresponding data.
     * Run validation only if the field has validation configured.
     */
    const invalidFields = [];
    for (const field of contentModel.fields) {
        const error = await execValidation({ validatorList, field, data, context });
        if (!error) {
            continue;
        }
        invalidFields.push({
            fieldId: field.fieldId,
            error
        });
    }

    if (invalidFields.length > 0) {
        throw new WebinyError("Validation failed.", "VALIDATION_FAILED", invalidFields);
    }
};
