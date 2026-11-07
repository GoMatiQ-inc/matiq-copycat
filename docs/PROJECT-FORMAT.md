# MatiQ Guides project version 1

A `.mqguide` is a UTF-8 JSON container with `format: "matiq-guides"`, `version: 1`, one `guide` and a content-addressed `assets` inventory. Assets are embedded base64 PNG/JPEG bytes keyed by SHA-256, never filesystem paths. A file moves between standalone and suite even when their data directories differ. The tool dataVersion stays 1 until a qualified migration exists.

Guides and steps have stable UUIDv4 IDs. Steps contain instruction, notes, timestamp, source kind, optional HTTP(S) origin/application, image hash, normalized crop and normalized annotations. Source origins exclude paths, credentials, query strings and fragments. No captured field values, raw typing or clipboard contents belong in the format.

Limits: 128 MiB project, 500 steps, 1,000 assets, 16 MiB per image, 100 annotations per step. Import checks schema, media signatures, hashes, identities and asset references; it never extracts a project archive or follows asset paths. Invalid/missing assets fail visibly. Image decoding is additionally bounded by the editor before use.

The application writes a same-directory `.pending` file, fsyncs it, atomically renames it and fsyncs the directory. A surviving pending file is presented for explicit recovery. A `.lock` sidecar prevents a second writer. Only a verifiably dead process on the same host is automatically recovered; unknown hosts and ambiguous locks fail closed. Do not delete a lock while its writer is alive. An interrupted recovery mutex requires operator investigation.

Editable projects retain original screenshots and removable annotations. Never share these as redacted documentation. Sanitized sharing projects replace originals with flattened image pixels, clear source context/notes and replace instructions on redacted steps for manual review. Always inspect text and pixels before sharing; automatic masking is not guaranteed.
