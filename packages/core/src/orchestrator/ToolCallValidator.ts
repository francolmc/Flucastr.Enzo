export interface ToolValidationIssue {
  path: string;
  message: string;
}

export interface ToolValidationResult {
  valid: boolean;
  issues: ToolValidationIssue[];
}

type JsonSchema = Record<string, any>;

function valueTypeOf(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function pushIssue(issues: ToolValidationIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

function validateAgainstSchema(
  schema: JsonSchema,
  value: unknown,
  path: string,
  issues: ToolValidationIssue[]
): void {
  const expectedType = schema?.type;
  if (expectedType) {
    const actualType = valueTypeOf(value);
    const typeOk =
      expectedType === actualType ||
      (expectedType === 'number' && actualType === 'number') ||
      (expectedType === 'integer' && actualType === 'number' && Number.isInteger(value as number));
    if (!typeOk) {
      pushIssue(issues, path, `expected type "${expectedType}" but got "${actualType}"`);
      return;
    }
  }

  if (Array.isArray(schema?.enum) && schema.enum.length > 0 && !schema.enum.includes(value)) {
    pushIssue(issues, path, `value must be one of: ${schema.enum.join(', ')}`);
  }

  if (schema?.type === 'string') {
    if (typeof value === 'string') {
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        pushIssue(issues, path, `string length must be >= ${schema.minLength}`);
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        pushIssue(issues, path, `string length must be <= ${schema.maxLength}`);
      }
      if (typeof schema.pattern === 'string') {
        const re = new RegExp(schema.pattern);
        if (!re.test(value)) {
          pushIssue(issues, path, `string does not match pattern "${schema.pattern}"`);
        }
      }
    }
    return;
  }

  if (schema?.type === 'number' || schema?.type === 'integer') {
    if (typeof value === 'number') {
      if (schema.minimum !== undefined && value < schema.minimum) {
        pushIssue(issues, path, `number must be >= ${schema.minimum}`);
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        pushIssue(issues, path, `number must be <= ${schema.maximum}`);
      }
    }
    return;
  }

  if (schema?.type === 'array') {
    if (Array.isArray(value) && schema.items && typeof schema.items === 'object') {
      value.forEach((item, index) => {
        validateAgainstSchema(schema.items, item, `${path}[${index}]`, issues);
      });
    }
    return;
  }

  if (schema?.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return;
    }
    const objectValue = value as Record<string, unknown>;
    const required = Array.isArray(schema.required) ? schema.required.filter((item: any) => typeof item === 'string') : [];
    for (const key of required) {
      const fieldValue = objectValue[key];
      if (
        fieldValue === undefined ||
        fieldValue === null ||
        (typeof fieldValue === 'string' && fieldValue.trim().length === 0)
      ) {
        pushIssue(issues, `${path}.${key}`, 'is required');
      }
    }

    const properties: Record<string, JsonSchema> =
      schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
    for (const [key, fieldSchema] of Object.entries(properties)) {
      if (objectValue[key] !== undefined) {
        validateAgainstSchema(fieldSchema, objectValue[key], `${path}.${key}`, issues);
      }
    }

    if (schema.additionalProperties === false) {
      for (const key of Object.keys(objectValue)) {
        if (!Object.prototype.hasOwnProperty.call(properties, key)) {
          pushIssue(issues, `${path}.${key}`, 'is not allowed');
        }
      }
    }
  }
}

export class ToolCallValidator {
  static validate(input: unknown, schema: JsonSchema | undefined): ToolValidationResult {
    if (!schema || typeof schema !== 'object' || Object.keys(schema).length === 0) {
      return { valid: true, issues: [] };
    }
    const issues: ToolValidationIssue[] = [];
    validateAgainstSchema(schema, input, '$', issues);
    return { valid: issues.length === 0, issues };
  }
}
