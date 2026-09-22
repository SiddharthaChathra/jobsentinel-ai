import { Inject, Injectable, Logger } from '@nestjs/common';
import type { UrlStatus } from '@jobsentinel/types';
import { detectClosedMarkers, hasApplyForm, htmlToText } from '@jobsentinel/validation';
import { HttpError, type HttpClientPort } from '../common/http/http-client';
import { HTTP_CLIENT } from '../common/http/http.module';

export interface UrlProbeResult {
  originalUrl: string;
  finalUrl: string;
  httpStatus: number | null;
  urlStatus: UrlStatus;
  redirectChain: { url: string; status: number }[];
  /** Plain text of the final page, capped; null when nothing could be read. */
  pageText: string | null;
  applyFormDetected: boolean;
  closedMarkers: { code: string; detail: string }[];
  error?: string;
}

const PAGE_TEXT_LIMIT = 40_000;
const PROBE_BODY_LIMIT = 2 * 1024 * 1024;

/**
 * Fetches an application URL and reports what it found (docs 08 §3.3–3.4).
 * Never follows a redirect blindly: every hop is SSRF-checked by HttpClient and recorded, so the
 * *final* destination is what gets judged. A 403/429 means "could not verify", never "scam".
 */
@Injectable()
export class UrlProbeService {
  private readonly logger = new Logger(UrlProbeService.name);

  constructor(@Inject(HTTP_CLIENT) private readonly http: HttpClientPort) {}

  async probe(url: string, opts: { timeoutMs?: number } = {}): Promise<UrlProbeResult> {
    const base: UrlProbeResult = {
      originalUrl: url,
      finalUrl: url,
      httpStatus: null,
      urlStatus: 'UNCHECKED',
      redirectChain: [],
      pageText: null,
      applyFormDetected: false,
      closedMarkers: [],
    };

    try {
      const res = await this.http.request(url, {
        timeoutMs: opts.timeoutMs ?? 15_000,
        maxBodyBytes: PROBE_BODY_LIMIT,
        retries: 1,
        headers: { Accept: 'text/html,application/xhtml+xml' },
      });
      const html = res.text;
      const pageText = htmlToText(html).slice(0, PAGE_TEXT_LIMIT);
      const closedMarkers = detectClosedMarkers(pageText);
      const redirected = res.redirectChain.length > 0;

      let urlStatus: UrlStatus;
      if (res.status === 404 || res.status === 410) urlStatus = 'NOT_FOUND';
      else if (res.status === 401 || res.status === 403 || res.status === 429)
        urlStatus = 'BLOCKED';
      else if (res.status >= 500) urlStatus = 'ERROR';
      else if (closedMarkers.length > 0) urlStatus = 'CLOSED';
      else if (redirected) urlStatus = 'REDIRECTED';
      else if (res.ok) urlStatus = 'OK';
      else urlStatus = 'ERROR';

      return {
        ...base,
        finalUrl: res.url,
        httpStatus: res.status,
        urlStatus,
        redirectChain: res.redirectChain,
        pageText,
        applyFormDetected: hasApplyForm(html),
        closedMarkers,
      };
    } catch (err) {
      if (err instanceof HttpError) {
        const urlStatus: UrlStatus =
          err.code === 'TIMEOUT'
            ? 'TIMEOUT'
            : err.code === 'SSRF_BLOCKED' || err.code === 'INVALID_URL'
              ? 'BLOCKED'
              : 'ERROR';
        return { ...base, urlStatus, error: err.message.slice(0, 300) };
      }
      this.logger.warn(`probe ${url} failed: ${err instanceof Error ? err.message : String(err)}`);
      return {
        ...base,
        urlStatus: 'ERROR',
        error: err instanceof Error ? err.message.slice(0, 300) : 'unknown error',
      };
    }
  }
}
