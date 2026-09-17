/**
 * Placeholder for a later generic CSV/Excel import.
 *
 * Explicitly OUT of v1 / Week 2:
 * - ChiroTouch EOD parsers
 * - SimplePractice-specific formats
 * - OpenAI column mapping (no OpenAI client anywhere)
 */
export const IMPORT_STUB_MESSAGE =
  "CSV/Excel import is not implemented in Week 2. A generic spreadsheet import will land later. ChiroTouch parsers and OpenAI mapping are out of v1.";

export function importNotImplemented() {
  return {
    status: 501 as const,
    body: {
      error: "not_implemented",
      message: IMPORT_STUB_MESSAGE,
      openai: false,
      chirotouch: false,
    },
  };
}
