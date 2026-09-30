# ADR-0009: Attachment validation, storage and download

- Status: Accepted
- Date: 2026-09-30
- Requirements: FR-1, FR-10, FR-19, NFR-7, NFR-8

## Context

Customers attach files when they submit a ticket (FR-1) and when they reply, and agents attach files to replies and internal notes. Every one of these files comes from someone we don't control, and agents will open them. An attachment is the easiest way to deliver malware to a support team, or to get script running on our own origin.

FR-19 and NFR-8 require that files are validated by their actual content (not their extension), size-capped, and stored somewhere that isn't directly reachable from the web, behind an authenticated download.

## Decision

### 1. What we accept

Files are checked by their content, never by filename or by the content type the browser declares.

| Type                             | How it is recognised                                                                                                                          | Served as                   |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| PNG, JPEG, GIF, WebP             | Magic bytes, using the `file-type` library                                                                                                    | The detected image type     |
| PDF                              | Magic bytes                                                                                                                                   | `application/pdf`           |
| Plain text (logs, notes, config) | No binary signature is found, and the bytes are valid UTF-8 with no NUL or other control characters except tab, carriage return and line feed | `text/plain; charset=utf-8` |

Everything else is refused with 415, including executables, archives and Office documents.

- An executable renamed to `invoice.pdf` still starts with an executable header, so it is refused.
- SVG and HTML have no binary signature. They can only get in under the plain-text rule, and are then always served as `text/plain` downloads, which browsers don't render.
- Office documents are refused because they can carry macros and embedded objects. Customers can send a PDF instead. Widening the allowlist is safe once scanning (section 5) is in place.

### 2. Limits

- A single file can be at most 10 MB. A single ticket submission or message can carry at most 5 files.
- The size limit is enforced while the upload streams in. The upload is cut off the moment it passes the limit, so an oversized file never sits whole in memory. The response is 413.
- The original filename is kept only for display and as the download name. Path separators and control characters are stripped from it, it is truncated to 255 bytes, and it is never used to build a storage key.

### 3. Storage

- Each file is stored under a random object key, `attachments/<random UUID>`, in a private bucket with no anonymous access policy.
- The object store is reachable only on the internal network. Browsers never talk to it.
- The `attachments` row records the ticket, the message (if any), the uploader, the detected content type, the size, a SHA-256 hash, the cleaned filename and the object key.

Order of operations:

1. The file is validated while it streams to the object store.
2. The database rows are written in the same transaction as the ticket or message.
3. If that transaction fails, the API deletes the objects it just uploaded.
4. In case the process dies between steps, a periodic sweep deletes objects older than a day that have no matching row.

### 4. Download

- `GET /api/v1/customer/tickets/{ticketId}/attachments/{attachmentId}` and `GET /api/v1/staff/tickets/{ticketId}/attachments/{attachmentId}`.
- An attachment inherits the visibility of the ticket and message it belongs to. An attachment on an internal note doesn't exist as far as a customer is concerned (404), and neither does an attachment on another customer's ticket.
- The API streams the file with these headers:

```http
Content-Type: <detected type>
Content-Disposition: attachment; filename*=UTF-8''<percent-encoded name>
X-Content-Type-Options: nosniff
Cache-Control: private, no-store
Content-Security-Policy: default-src 'none'; sandbox
```

`attachment` makes the browser download rather than display the file. `nosniff` stops it second-guessing the content type. The sandboxing policy is a last line of defence if a browser renders the file anyway.

**Why stream through the API rather than hand out presigned URLs.** A presigned URL means the object store must be reachable from browsers, and anyone holding the URL can fetch the file until it expires, whether or not they are still allowed to. Streaming keeps one door with one access check on every request. At much larger volumes the trade-off flips, because the API carries all the download bandwidth. Short-lived presigned URLs behind a CDN then become the better option.

### 5. Not in v1

- Antivirus scanning. The plan: ClamAV in the worker, a `scan_status` column on `attachments`, and downloads blocked until a file is marked clean.
- Image thumbnails, or re-encoding images to strip metadata.
- Per-customer storage quotas.

## Consequences

- A renamed executable can't get in, and nothing uploaded can run on our origin.
- Downloads have exactly one path, and it always checks access.
- Legitimate files outside the allowlist (Office documents, zip files) are refused, so agents sometimes have to ask for a PDF or a screenshot instead.
- The API carries the download traffic. That is fine at v1 volumes and is noted as a scaling point.

## Alternatives considered

- **Browsers uploading straight to the object store with presigned URLs.** Saves API bandwidth, but the file then has to be validated after it lands, asynchronously and with a quarantine step. That is a better fit at a much larger scale.
- **Trusting the browser's declared content type or the file extension.** Both are under the uploader's control.
- **Showing images inline in the ticket thread.** Convenient, but files that are valid as two formats at once (polyglots) make inline rendering risky. v1 uses downloads only.

## Verification

- Integration, accepted: a PNG, a JPEG, a PDF and a UTF-8 log file are all accepted, with the detected type stored.
- Integration, refused with 415:
  - a Windows executable renamed to `.pdf`;
  - an ELF binary;
  - a zip archive;
  - a text file containing NUL bytes.
- Integration, limits: a file of 10 MB plus one byte gives 413; six files in one request gives 400.
- Integration, access: a customer requesting an internal-note attachment gets 404, and so does another customer requesting someone else's attachment.
- Integration, headers: download responses carry exactly the headers above.
- Integration, storage: the object key never contains the original filename, and an anonymous S3 GET on the bucket is refused.
