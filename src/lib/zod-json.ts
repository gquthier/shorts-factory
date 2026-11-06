import { z } from 'zod';

type Json = Record<string, unknown>;

/** The small JSON Schema subset the factory's response schemas use. */
export function zodToJsonSchema(schema: z.ZodTypeAny): Json {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    const required = Object.entries(shape).filter(([, v]) => !v.isOptional()).map(([k]) => k);
    return { type: 'object', additionalProperties: false, required, properties: Object.fromEntries(Object.entries(shape).map(([k, v]) => [k, zodToJsonSchema(v)])) };
  }
  if (schema instanceof z.ZodArray) return { type: 'array', items: zodToJsonSchema(schema.element as z.ZodTypeAny) };
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) return zodToJsonSchema(schema.unwrap() as z.ZodTypeAny);
  if (schema instanceof z.ZodEnum) return { type: 'string', enum: schema.options as string[] };
  if (schema instanceof z.ZodTuple) return { type: 'array', items: { type: 'string' } };
  if (schema instanceof z.ZodString) return { type: 'string' };
  if (schema instanceof z.ZodNumber) return { type: 'number' };
  if (schema instanceof z.ZodBoolean) return { type: 'boolean' };
  throw new Error(`Unsupported zod type: ${schema.constructor.name}`);
}
