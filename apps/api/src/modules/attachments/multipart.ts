import type {
  Multipart,
  MultipartFile,
  MultipartValue,
} from "@fastify/multipart";
import {
  ATTACHMENT_LIMITS,
  ATTACHMENTS_FIELD,
  PROBLEM_TYPES,
} from "@dsd/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ZodValidationException } from "nestjs-zod";
import { z } from "zod";

import { ProblemException } from "../../common/problem-details.js";

/** A file part as it arrives, before anything has looked at its bytes. */
export interface IncomingFile {
  /** The name the browser sent, untrusted. */
  filename: string;
  /** The whole file, read with the size cap enforced while it streams in (413 past it). */
  read(): Promise<Buffer>;
}

/** A multipart request with its fields validated and its files still to read. */
export interface Submission<Fields> {
  fields: Fields;
  /** The files in the order they were sent; each must be read before the next. */
  files: AsyncIterable<IncomingFile>;
}

/** A 400 with the same `validation-error` body a JSON request gets. */
function invalid(path: string, message: string): ZodValidationException {
  return new ZodValidationException(
    new z.ZodError([
      { code: "custom", path: [path], message, input: undefined },
    ]),
  );
}

/** The multipart plugin's limit errors, as this API's problems. */
function translate(error: unknown): unknown {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? error.code
      : undefined;
  switch (code) {
    case "FST_REQ_FILE_TOO_LARGE":
      return new ProblemException(
        413,
        PROBLEM_TYPES.blank,
        `Each file can be at most ${ATTACHMENT_LIMITS.maxBytes / (1024 * 1024)} MB.`,
      );
    case "FST_FILES_LIMIT":
      return invalid(
        ATTACHMENTS_FIELD,
        `Send at most ${ATTACHMENT_LIMITS.maxFiles} files at once`,
      );
    case "FST_FIELDS_LIMIT":
    case "FST_PARTS_LIMIT":
    case "FST_PROTO_VIOLATION":
    case "FST_INVALID_JSON_FIELD_ERROR":
      return invalid("", "The form has more parts than this request takes");
    default:
      return error;
  }
}

/**
 * Reads a multipart/form-data request the way ADR-0011 sets out: every
 * field first, then the files. The fields are validated against `schema`
 * as soon as the first file arrives, before a single byte of it is read,
 * so a bad form never costs an upload. Files must all come in the
 * `attachments` field, and a field after a file is refused.
 *
 * The files are returned unread, so the caller can check the request is
 * allowed at all (for example that the ticket is visible) before reading
 * them.
 */
export async function readSubmission<Schema extends z.ZodType>(
  request: FastifyRequest,
  schema: Schema,
): Promise<Submission<z.output<Schema>>> {
  if (!request.isMultipart()) {
    throw new ProblemException(
      415,
      PROBLEM_TYPES.blank,
      "Send this as multipart/form-data: the fields first, then any files in `attachments`.",
    );
  }
  const parts = request.parts()[Symbol.asyncIterator]();
  const next = async (): Promise<Multipart | undefined> => {
    try {
      const result = await parts.next();
      return result.done === true ? undefined : result.value;
    } catch (error) {
      throw translate(error);
    }
  };

  const values: Record<string, string> = {};
  let part = await next();
  while (part?.type === "field") {
    if (part.fieldname === ATTACHMENTS_FIELD) {
      assertNoFileChosen(part);
    } else {
      if (part.fieldnameTruncated || part.valueTruncated) {
        throw invalid(part.fieldname, "Too long");
      }
      if (typeof part.value !== "string") {
        throw invalid(part.fieldname, "Must be plain text");
      }
      if (Object.hasOwn(values, part.fieldname)) {
        throw invalid(part.fieldname, "Sent more than once");
      }
      values[part.fieldname] = part.value;
    }
    part = await next();
  }

  const parsed = schema.safeParse(values);
  if (!parsed.success) throw new ZodValidationException(parsed.error);

  const first: MultipartFile | undefined =
    part?.type === "file" ? part : undefined;
  async function* files(): AsyncGenerator<IncomingFile> {
    let current: Multipart | undefined = first;
    while (current !== undefined) {
      if (current.type === "field") {
        if (current.fieldname !== ATTACHMENTS_FIELD) {
          throw invalid(
            current.fieldname,
            "Send every field before the first file",
          );
        }
        assertNoFileChosen(current);
      } else {
        if (current.fieldname !== ATTACHMENTS_FIELD) {
          throw invalid(
            current.fieldname,
            `Send files in the \`${ATTACHMENTS_FIELD}\` field`,
          );
        }
        const file = current;
        const read = async () => {
          try {
            return await file.toBuffer();
          } catch (error) {
            throw translate(error);
          }
        };
        // A file input left empty arrives as a nameless file with no bytes.
        const unnamed = file.filename === "" ? await read() : undefined;
        if (unnamed === undefined) {
          yield { filename: file.filename, read };
        } else if (unnamed.length > 0) {
          yield { filename: "", read: () => Promise.resolve(unnamed) };
        }
      }
      current = await next();
    }
  }
  return { fields: parsed.data, files: files() };
}

/**
 * An empty value in the file field means "no file chosen": Swagger UI and
 * some form libraries send one for an unused file input. Text there is a
 * mistake, not a file.
 */
function assertNoFileChosen(part: MultipartValue): void {
  if (part.value !== "") {
    throw invalid(ATTACHMENTS_FIELD, "Must be a file, not text");
  }
}

/**
 * Runs `handle` on a multipart submission. If it fails before the whole
 * upload has been read (a validation error, a ticket the caller can't see,
 * a file over the limit), the response asks to close the connection, so
 * the client stops sending the rest instead of the server waiting for it.
 */
export async function withSubmission<Schema extends z.ZodType, Result>(
  request: FastifyRequest,
  reply: FastifyReply,
  schema: Schema,
  handle: (submission: Submission<z.output<Schema>>) => Promise<Result>,
): Promise<Result> {
  try {
    return await handle(await readSubmission(request, schema));
  } catch (error) {
    if (!request.raw.readableEnded) void reply.header("connection", "close");
    throw error;
  }
}
