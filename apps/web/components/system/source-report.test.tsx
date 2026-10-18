import { describe, expect, it, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ApiError } from '@/lib/api';

// ── Mock data derived from docs/contracts/source-report.mock.json ─────────────

const MOCK_REPORT = {
  days: 30 as const,
  generatedAt: '2026-10-17T14:30:00.000Z',
  totals: { collected: 1210, kept: 23 },
  sources: [
    {
      id: '6f1c2a3b-1d2e-4f50-8a9b-0c1d2e3f4a5b',
      name: 'Adzuna: India graduate engineer',
      type: 'PUBLIC_API' as const,
      adapter: 'adzuna',
      company: null,
      status: 'ACTIVE' as const,
      health: 'OK' as const,
      createdAt: '2026-09-22T03:10:00.000Z',
      collected: 239,
      kept: 20,
      rejected: {
        LOCATION: 0,
        EXPERIENCE: 151,
        BATCH: 3,
        CATEGORY: 41,
        VALIDATION: 12,
        EXPIRED: 4,
        STALE: 0,
        PENDING: 8,
        OTHER: 0,
      },
      lastKeptAt: '2026-10-17T09:00:00.000Z',
      lastSuccessfulScan: '2026-10-17T14:00:00.000Z',
      lastError: null,
      consecutiveFailures: 0,
      pausedAt: null,
      pausedReason: null,
      resumedAt: null,
      pauseExempt: true,
    },
    {
      id: '7a2b3c4d-2e3f-4a51-9b0c-1d2e3f4a5b6c',
      name: 'Greenhouse: Elastic',
      type: 'ATS_API' as const,
      adapter: 'greenhouse',
      company: { id: '8b3c4d5e-3f4a-4b62-8c1d-2e3f4a5b6c7d', name: 'Elastic' },
      status: 'PAUSED_AUTO' as const,
      health: 'PAUSED' as const,
      createdAt: '2026-09-22T03:10:00.000Z',
      collected: 503,
      kept: 0,
      rejected: {
        LOCATION: 318,
        EXPERIENCE: 160,
        BATCH: 0,
        CATEGORY: 25,
        VALIDATION: 0,
        EXPIRED: 0,
        STALE: 0,
        PENDING: 0,
        OTHER: 0,
      },
      lastKeptAt: null,
      lastSuccessfulScan: '2026-10-16T22:00:00.000Z',
      lastError: null,
      consecutiveFailures: 0,
      pausedAt: '2026-10-17T14:00:00.000Z',
      pausedReason:
        'collected 503 jobs in 30 days and kept none (location 318, experience 160, category 25)',
      resumedAt: null,
      pauseExempt: false,
    },
    {
      id: '9c4d5e6f-4a5b-4c73-9d2e-3f4a5b6c7d8e',
      name: 'Lever: Example Startup',
      type: 'ATS_API' as const,
      adapter: 'lever',
      company: { id: 'ad5e6f7a-5b6c-4d84-8e3f-4a5b6c7d8e9f', name: 'Example Startup' },
      status: 'FAILING' as const,
      health: 'ERRORS' as const,
      createdAt: '2026-09-22T03:10:00.000Z',
      collected: 0,
      kept: 0,
      rejected: {
        LOCATION: 0,
        EXPERIENCE: 0,
        BATCH: 0,
        CATEGORY: 0,
        VALIDATION: 0,
        EXPIRED: 0,
        STALE: 0,
        PENDING: 0,
        OTHER: 0,
      },
      lastKeptAt: '2026-09-30T08:00:00.000Z',
      lastSuccessfulScan: '2026-10-12T10:00:00.000Z',
      lastError: 'HTTP 503 from api.lever.co',
      consecutiveFailures: 4,
      pausedAt: null,
      pausedReason: null,
      resumedAt: null,
      pauseExempt: false,
    },
    {
      id: 'be6f7a8b-6c7d-4e95-9f4a-5b6c7d8e9fa0',
      name: 'RSS: Example feed',
      type: 'RSS' as const,
      adapter: 'rss',
      company: null,
      status: 'ACTIVE' as const,
      health: 'COLLECTED_NOTHING' as const,
      createdAt: '2026-09-22T03:10:00.000Z',
      collected: 0,
      kept: 0,
      rejected: {
        LOCATION: 0,
        EXPERIENCE: 0,
        BATCH: 0,
        CATEGORY: 0,
        VALIDATION: 0,
        EXPIRED: 0,
        STALE: 0,
        PENDING: 0,
        OTHER: 0,
      },
      lastKeptAt: null,
      lastSuccessfulScan: '2026-10-17T13:30:00.000Z',
      lastError: null,
      consecutiveFailures: 0,
      pausedAt: null,
      pausedReason: null,
      resumedAt: null,
      pauseExempt: false,
    },
    {
      id: 'cf7a8b9c-7d8e-4fa6-8a5b-6c7d8e9fa0b1',
      name: 'Greenhouse: Datadog',
      type: 'ATS_API' as const,
      adapter: 'greenhouse',
      company: { id: 'd08b9cad-8e9f-4ab7-9b6c-7d8e9fa0b1c2', name: 'Datadog' },
      status: 'ACTIVE' as const,
      health: 'KEPT_ZERO' as const,
      createdAt: '2026-10-01T03:10:00.000Z',
      collected: 468,
      kept: 0,
      rejected: {
        LOCATION: 301,
        EXPERIENCE: 140,
        BATCH: 0,
        CATEGORY: 27,
        VALIDATION: 0,
        EXPIRED: 0,
        STALE: 0,
        PENDING: 0,
        OTHER: 0,
      },
      lastKeptAt: '2026-09-28T11:00:00.000Z',
      lastSuccessfulScan: '2026-10-17T13:45:00.000Z',
      lastError: null,
      consecutiveFailures: 0,
      pausedAt: null,
      pausedReason: null,
      resumedAt: null,
      pauseExempt: false,
    },
  ],
};

const MOCK_EMPTY = {
  days: 7 as const,
  generatedAt: '2026-10-17T14:30:00.000Z',
  totals: { collected: 0, kept: 0 },
  sources: [],
};

const MOCK_RESUME = { id: '7a2b3c4d-2e3f-4a51-9b0c-1d2e3f4a5b6c', status: 'ACTIVE' };

// ── Mock modules ──────────────────────────────────────────────────────────────

const mockGet = vi.fn();
const mockPost = vi.fn();

vi.mock('@/hooks/use-api', () => ({
  useApi: () => ({
    get: mockGet,
    post: mockPost,
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
  }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'test' } } }) },
  }),
}));

let mockMe: { user: { isAdmin: boolean } } | undefined;
vi.mock('@/hooks/useUser', () => ({
  useMe: () => ({
    data: mockMe,
    isLoading: false,
  }),
}));

vi.mock('@/components/common/RelativeTime', () => ({
  RelativeTime: ({ date }: { date: string }) => <span>{date}</span>,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const SYSTEM_STATUS_STUB = {
  worker: { alive: true, lastBeatAt: null, hostname: null, version: null, currentTask: null },
  sources: { total: 0, active: 0, degraded: 0, failing: 0, disabled: 0, nextScanAt: null },
  lastScans: [],
  pipeline: {},
  jobsLast24h: { found: 0, new: 0 },
  totals: { jobs: 0, companies: 0 },
  ai: { callsToday: 0, callBudget: 0, tokensToday: 0, tokenBudget: 0 },
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockMe = { user: { isAdmin: true } };

  mockGet.mockImplementation(async (path: string) => {
    if (path.startsWith('/sources/report')) return { data: MOCK_REPORT };
    if (path === '/sources') return { data: [] };
    if (path === '/system/status') return { data: SYSTEM_STATUS_STUB };
    return { data: null };
  });
  mockPost.mockResolvedValue({ data: MOCK_RESUME });
});

describe('SourceReportCard', () => {
  async function renderReportCard() {
    const { SourceReportCard } = await import('@/components/system/SourceReportCard');
    const isAdmin = mockMe?.user.isAdmin === true;
    return render(<SourceReportCard isAdmin={isAdmin} />, { wrapper });
  }

  async function renderSystemPageComponent() {
    const mod = await import('@/app/(app)/system/page');
    const SystemPage = mod.default;
    return render(<SystemPage />, { wrapper });
  }

  // ── 1. Health badges ──────────────────────────────────────────────────────

  it('renders OK health badge with correct label', async () => {
    await renderReportCard();
    await waitFor(() => {
      const badge = screen.getByTestId('source-health-6f1c2a3b-1d2e-4f50-8a9b-0c1d2e3f4a5b');
      expect(badge).toHaveTextContent('OK');
      expect(badge).toHaveAttribute('title', 'Finding fresher jobs');
    });
  });

  it('renders PAUSED health badge', async () => {
    await renderReportCard();
    await waitFor(() => {
      const badge = screen.getByTestId('source-health-7a2b3c4d-2e3f-4a51-9b0c-1d2e3f4a5b6c');
      expect(badge).toHaveTextContent('Paused');
      expect(badge).toHaveAttribute('title', 'Auto-paused');
    });
  });

  it('renders ERRORS health badge', async () => {
    await renderReportCard();
    await waitFor(() => {
      const badge = screen.getByTestId('source-health-9c4d5e6f-4a5b-4c73-9d2e-3f4a5b6c7d8e');
      expect(badge).toHaveTextContent('Errors');
      expect(badge).toHaveAttribute('title', 'Failing; retrying with backoff');
    });
  });

  it('renders COLLECTED_NOTHING health badge', async () => {
    await renderReportCard();
    await waitFor(() => {
      const badge = screen.getByTestId('source-health-be6f7a8b-6c7d-4e95-9f4a-5b6c7d8e9fa0');
      expect(badge).toHaveTextContent('Nothing Found');
      expect(badge).toHaveAttribute('title', 'Found nothing; may be broken');
    });
  });

  it('renders KEPT_ZERO health badge', async () => {
    await renderReportCard();
    await waitFor(() => {
      const badge = screen.getByTestId('source-health-cf7a8b9c-7d8e-4fa6-8a5b-6c7d8e9fa0b1');
      expect(badge).toHaveTextContent('Kept Zero');
      expect(badge).toHaveAttribute('title', 'Collects jobs, none fit');
    });
  });

  // ── 2. Rejected breakdown ─────────────────────────────────────────────────

  it('hides zero-count reject reasons and shows PENDING as "Still processing"', async () => {
    await renderReportCard();
    await waitFor(() => {
      const row = screen.getByTestId('source-row-6f1c2a3b-1d2e-4f50-8a9b-0c1d2e3f4a5b');
      expect(within(row).getByText('Asks for experience')).toBeInTheDocument();
      expect(within(row).getByText('Not engineering')).toBeInTheDocument();
      expect(within(row).queryByText('Outside India')).not.toBeInTheDocument();
      expect(within(row).queryByText('Older than 60 days')).not.toBeInTheDocument();
      expect(within(row).getByText('Still processing')).toBeInTheDocument();
    });
  });

  // ── 3. Days toggle ────────────────────────────────────────────────────────

  it('toggles between 7 and 30 days and changes the request', async () => {
    await renderReportCard();

    await waitFor(() => {
      expect(screen.getByTestId('source-report-days-7')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('source-report-days-7'));

    await waitFor(() => {
      const reportCalls = mockGet.mock.calls.filter(
        (c: unknown[]) =>
          typeof c[0] === 'string' && (c[0] as string).startsWith('/sources/report'),
      );
      expect(
        reportCalls.some((c: unknown[]) => {
          const query = c[1] as Record<string, unknown> | undefined;
          return query?.days === 7;
        }),
      ).toBe(true);
    });
  });

  // ── 4. Resume flow ────────────────────────────────────────────────────────

  it('resumes a paused source after confirmation', async () => {
    await renderReportCard();

    await waitFor(() => {
      expect(
        screen.getByTestId('source-resume-7a2b3c4d-2e3f-4a51-9b0c-1d2e3f4a5b6c'),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('source-resume-7a2b3c4d-2e3f-4a51-9b0c-1d2e3f4a5b6c'));

    await waitFor(() => {
      expect(screen.getByTestId('source-resume-confirm')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('source-resume-confirm'));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/sources/7a2b3c4d-2e3f-4a51-9b0c-1d2e3f4a5b6c/resume');
      expect(screen.getByText('Source resumed successfully')).toBeInTheDocument();
    });
  });

  it('shows "Already active" on 409', async () => {
    mockPost.mockRejectedValueOnce(
      new ApiError(409, 'SOURCE_NOT_PAUSED', 'Source is ACTIVE, not auto-paused'),
    );

    await renderReportCard();

    await waitFor(() => {
      expect(
        screen.getByTestId('source-resume-7a2b3c4d-2e3f-4a51-9b0c-1d2e3f4a5b6c'),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('source-resume-7a2b3c4d-2e3f-4a51-9b0c-1d2e3f4a5b6c'));
    await waitFor(() => {
      expect(screen.getByTestId('source-resume-confirm')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('source-resume-confirm'));

    await waitFor(() => {
      expect(screen.getByText('Already active')).toBeInTheDocument();
    });
  });

  it('disables the resume button while pending', async () => {
    mockPost.mockImplementation(() => new Promise(() => {}));

    await renderReportCard();
    await waitFor(() => {
      expect(
        screen.getByTestId('source-resume-7a2b3c4d-2e3f-4a51-9b0c-1d2e3f4a5b6c'),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('source-resume-7a2b3c4d-2e3f-4a51-9b0c-1d2e3f4a5b6c'));
    await waitFor(() => {
      expect(screen.getByTestId('source-resume-confirm')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('source-resume-confirm'));

    await waitFor(() => {
      expect(screen.getByTestId('source-resume-confirm')).toBeDisabled();
    });
  });

  // ── 5. Loading, empty, error states ───────────────────────────────────────

  it('shows loading skeleton', async () => {
    mockGet.mockImplementation(() => new Promise(() => {}));
    await renderReportCard();
    await waitFor(() => {
      expect(screen.getByLabelText('Loading source report')).toBeInTheDocument();
    });
  });

  it('shows empty state message', async () => {
    mockGet.mockImplementation(async (path: string) => {
      if (path.startsWith('/sources/report')) return { data: MOCK_EMPTY };
      return { data: null };
    });

    await renderReportCard();
    await waitFor(() => {
      expect(screen.getByTestId('source-report-empty')).toBeInTheDocument();
      expect(screen.getByText(/No sources configured/)).toBeInTheDocument();
    });
  });

  it('shows error state with retry button', async () => {
    mockGet.mockImplementation(async (path: string) => {
      if (path.startsWith('/sources/report')) throw new ApiError(500, 'INTERNAL', 'Server error');
      return { data: null };
    });

    await renderReportCard();
    await waitFor(() => {
      expect(screen.getByTestId('source-report-error')).toBeInTheDocument();
      expect(screen.getByText('Failed to load report')).toBeInTheDocument();
    });

    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  // ── 6. Non-admin renders nothing ──────────────────────────────────────────

  it('renders nothing and makes no request for non-admin', async () => {
    mockMe = { user: { isAdmin: false } };
    const { container } = await renderReportCard();

    expect(container.innerHTML).toBe('');
    const reportCalls = (mockGet as Mock).mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).startsWith('/sources/report'),
    );
    expect(reportCalls).toHaveLength(0);
  });

  // ── 7. PAUSED_AUTO in existing source list ────────────────────────────────

  it('shows "Auto-paused" for a PAUSED_AUTO source in the system status table', async () => {
    mockGet.mockImplementation(async (path: string) => {
      if (path === '/sources') {
        return {
          data: [
            {
              id: '7a2b3c4d-2e3f-4a51-9b0c-1d2e3f4a5b6c',
              name: 'Greenhouse: Elastic',
              type: 'ATS_API',
              adapter: 'greenhouse',
              config: {},
              company: null,
              enabled: false,
              priority: 'NORMAL',
              scanIntervalSec: null,
              status: 'PAUSED_AUTO',
              nextScanAt: null,
              lastAttemptedScan: null,
              lastSuccessfulScan: null,
              lastError: null,
              consecutiveFailures: 0,
              leased: false,
              manualRequested: false,
              jobsCount: 0,
            },
          ],
        };
      }
      if (path === '/system/status')
        return {
          data: {
            ...SYSTEM_STATUS_STUB,
            sources: { ...SYSTEM_STATUS_STUB.sources, total: 1 },
          },
        };
      if (path.startsWith('/sources/report')) return { data: MOCK_EMPTY };
      return { data: null };
    });

    await renderSystemPageComponent();

    await waitFor(() => {
      expect(screen.getByText('Auto-paused')).toBeInTheDocument();
    });
  });

  // ── 8. pauseExempt tag ────────────────────────────────────────────────────

  it('shows "Exempt from auto-pause" tag for pauseExempt sources', async () => {
    await renderReportCard();
    await waitFor(() => {
      const row = screen.getByTestId('source-row-6f1c2a3b-1d2e-4f50-8a9b-0c1d2e3f4a5b');
      expect(within(row).getByText('Exempt from auto-pause')).toBeInTheDocument();
    });
  });

  // ── 9. Placeholders skipped (D117) ────────────────────────────────────────

  it('shows "Placeholders skipped: N" with tooltip for a source when placeholdersSkipped > 0', async () => {
    const reportWithPlaceholders = {
      ...MOCK_REPORT,
      sources: [
        {
          ...MOCK_REPORT.sources[0],
          placeholdersSkipped: 3,
        },
        ...MOCK_REPORT.sources.slice(1),
      ],
    };
    mockGet.mockImplementation(async (path: string) => {
      if (path.startsWith('/sources/report')) return { data: reportWithPlaceholders };
      return { data: null };
    });

    await renderReportCard();
    await waitFor(() => {
      const el = screen.getByTestId(`placeholders-skipped-${MOCK_REPORT.sources[0]!.id}`);
      expect(el).toBeInTheDocument();
      expect(el).toHaveTextContent('Placeholders skipped: 3');
      expect(el).toHaveAttribute(
        'title',
        'Talent-pool and general-application postings. Not jobs, so not counted as collected or kept.',
      );
    });
  });

  it('hides placeholders skipped for a source when placeholdersSkipped is 0 or absent', async () => {
    const reportWithoutPlaceholders = {
      ...MOCK_REPORT,
      sources: [
        {
          ...MOCK_REPORT.sources[0],
          placeholdersSkipped: 0,
        },
        {
          ...MOCK_REPORT.sources[1],
          placeholdersSkipped: undefined,
        },
      ],
    };
    mockGet.mockImplementation(async (path: string) => {
      if (path.startsWith('/sources/report')) return { data: reportWithoutPlaceholders };
      return { data: null };
    });

    await renderReportCard();
    await waitFor(() => {
      expect(
        screen.queryByTestId(`placeholders-skipped-${MOCK_REPORT.sources[0]!.id}`),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId(`placeholders-skipped-${MOCK_REPORT.sources[1]!.id}`),
      ).not.toBeInTheDocument();
    });
  });

  it('shows total in summary strip with tooltip when totals.placeholdersSkipped > 0', async () => {
    const reportWithTotal = {
      ...MOCK_REPORT,
      totals: {
        ...MOCK_REPORT.totals,
        placeholdersSkipped: 5,
      },
    };
    mockGet.mockImplementation(async (path: string) => {
      if (path.startsWith('/sources/report')) return { data: reportWithTotal };
      return { data: null };
    });

    await renderReportCard();
    await waitFor(() => {
      const el = screen.getByTestId('placeholders-skipped-total');
      expect(el).toBeInTheDocument();
      expect(el).toHaveTextContent('5');
      expect(el).toHaveTextContent('Placeholders skipped');
      expect(el).toHaveAttribute(
        'title',
        'Talent-pool and general-application postings. Not jobs, so not counted as collected or kept.',
      );
    });
  });

  it('hides total in summary strip when totals.placeholdersSkipped is 0 or absent', async () => {
    const reportWithoutTotal = {
      ...MOCK_REPORT,
      totals: {
        ...MOCK_REPORT.totals,
        placeholdersSkipped: 0,
      },
    };
    mockGet.mockImplementation(async (path: string) => {
      if (path.startsWith('/sources/report')) return { data: reportWithoutTotal };
      return { data: null };
    });

    await renderReportCard();
    await waitFor(() => {
      expect(screen.queryByTestId('placeholders-skipped-total')).not.toBeInTheDocument();
    });
  });
});
