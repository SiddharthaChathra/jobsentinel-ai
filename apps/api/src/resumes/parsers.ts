import mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';
import { AppError } from '../common/errors/app-error';

export const PDF_MIME = 'application/pdf';
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Trusts magic bytes, not the client-declared MIME type or extension (docs 11 §2). */
export function sniffResumeMime(buffer: Buffer): typeof PDF_MIME | typeof DOCX_MIME | null {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-') return PDF_MIME;
  // DOCX is a ZIP (PK\x03\x04) containing [Content_Types].xml and word/ — a plain .zip would fail later in mammoth.
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  ) {
    return buffer.includes('word/', 0, 'latin1') ? DOCX_MIME : null;
  }
  return null;
}

export interface ParsedResume {
  text: string;
  pages: number | null;
}

const MAX_TEXT_CHARS = 60_000;

export async function parseResume(buffer: Buffer, mime: string): Promise<ParsedResume> {
  let text: string;
  let pages: number | null = null;
  try {
    if (mime === PDF_MIME) {
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      pages = pdf.numPages;
      const result = await extractText(pdf, { mergePages: true });
      text = result.text;
    } else if (mime === DOCX_MIME) {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
    } else {
      throw AppError.unprocessable(
        'UNSUPPORTED_FILE_TYPE',
        'Only PDF and DOCX resumes are supported',
      );
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw AppError.unprocessable(
      'RESUME_PARSE_FAILED',
      `Could not read the file: ${err instanceof Error ? err.message : 'unknown error'}`,
    );
  }
  text = cleanText(text).slice(0, MAX_TEXT_CHARS);
  if (text.length < 80) {
    throw AppError.unprocessable(
      'RESUME_NO_TEXT',
      'No readable text found. Scanned/image-only PDFs are not supported — please upload a text-based PDF or DOCX.',
    );
  }
  return { text, pages };
}

export function cleanText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .split('\u0000')
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Minimal PII redaction before text leaves the server for an AI provider (docs 09 §1, 11 §2):
 * emails, phone numbers and URLs become placeholders. The candidate's name stays (needed for the profile).
 */
export function redactForAi(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]')
    .replace(/(?:\+?\d[\d\s().-]{8,}\d)/g, (m) =>
      m.replace(/\D/g, '').length >= 10 ? '[phone]' : m,
    )
    .replace(/https?:\/\/\S+|www\.\S+/gi, '[link]')
    .replace(/\b(?:linkedin|github)\.com\/\S+/gi, '[link]');
}
