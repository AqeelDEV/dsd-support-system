/*
 * Client-side form checks with the shared zod schemas (ADR-0002): the same
 * schema the API validates with decides, and the form only chooses the
 * words. The API checks again; this is for instant feedback.
 */

interface SchemaLike<T> {
  safeParse(value: unknown):
    | { success: true; data: T }
    | {
        success: false;
        error: { issues: readonly { path: readonly PropertyKey[] }[] };
      };
}

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

/**
 * The parsed value, or an error per field. Every issue on a field is shown
 * as that field's message from `messages`, so people read plain words
 * rather than the schema's.
 */
export function validateForm<T, K extends string>(
  schema: SchemaLike<T>,
  values: Record<K, unknown>,
  messages: Record<K, string>,
):
  | { data: T; errors?: undefined }
  | { data?: undefined; errors: FieldErrors<K> } {
  const result = schema.safeParse(values);
  if (result.success) return { data: result.data };
  const errors: FieldErrors<K> = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && field in messages) {
      const key = field as K;
      errors[key] ??= messages[key];
    }
  }
  return { errors };
}
