# Matching (live reference)

Design: [architecture/09-ai.md](architecture/09-ai.md) §5. This page documents what is implemented and how to operate it.

Matching answers one question per job, per user: **how well does this posting fit this person's resume and preferences?** It produces a 0–100 score with a priority band and a human-readable explanation. It never decides whether a job is real (that is [validation](architecture/08-validation.md)) and it never removes a job — a bad score is stored and ranked low, nothing more.

## Pipeline position

```
DISCOVERED → CLASSIFIED → VALIDATING → VALID ─┐
                                    NEEDS_REVIEW ─┴→ [match] → MATCHED → (Phase 8: NOTIFIED)
```

`VALID`, `NEEDS_REVIEW`, `MATCHED` and `NOTIFIED` jobs are all matchable. A `VALID` job becomes `MATCHED` once it has been scored; a `NEEDS_REVIEW` job keeps its status, because the user still has to judge it — it is scored so it can be ranked in the review queue, not to imply it passed.

## The deterministic scorer

`packages/validation/src/match/score.ts`. Pure, synchronous, fully unit-tested, and always the source of truth.

| component      | weight | how it is scored                                                                                                                                                                                                                                              |
| -------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **skill**      | 0.40   | Required skills matched / required skills, with nice-to-haves worth 0.4 each. Names are canonicalised through the skill dictionary first (`postgres` → `PostgreSQL`), so aliases match. A posting listing no skills at all scores a neutral 50 rather than 0. |
| **role**       | 0.30   | 100 for a PRIMARY preferred role family, 80 SECONDARY, 60 OTHER, 30 for a job merely in a wanted category, 10 otherwise.                                                                                                                                      |
| **experience** | 0.20   | FRESHER 100, ENTRY_LEVEL 85, UNKNOWN 50, and 0 for EXPERIENCED when `fresherOnly` is set (10 otherwise).                                                                                                                                                      |
| **location**   | 0.10   | 100 for a wanted city or an acceptable remote job, 75 for the right country, 60 when the posting states no location at all, 40/25 for a mismatch.                                                                                                             |

Bands: **VERY_HIGH** ≥ 90, **HIGH** ≥ 75, **MEDIUM** ≥ 60, **OTHER** below.

The explanation is built from the same evidence, not written by a model: `Match 82% — ✓ Python ✓ SQL ✗ Kubernetes · ✓ Fresher eligible · ✓ Preferred role · ✓ Bengaluru`.

## Where the AI helps, and how far it can go

Two prompts, both Zod-validated, both with a deterministic fallback:

1. `JOB_REQUIREMENTS` (`job-requirements.v1`) extracts the must-have/nice-to-have skills, year range and responsibilities that a posting actually states. This feeds the **deterministic** scorer again — a better baseline, still rules-only. This is the larger of the two wins: a description mentioning ten technologies in passing no longer looks like ten requirements.
2. `MATCH` (`match.v1`) judges equivalence a keyword set cannot ("REST APIs" ≈ "backend development") and returns `skillScore`/`roleScore` plus an explanation.

Bounds, in order:

- The AI is only called for jobs already scoring **≥ 35** deterministically. Hopeless matches are scored and stored without spending a call.
- Its `skillScore`/`roleScore` are clamped to **±25** of the deterministic values (`applyAiRefinement`). A model claiming 100 against a baseline of 58 yields 83, never 100.
- Experience and location are never AI-scored.
- If either call fails, times out or returns unparseable JSON, the deterministic score stands and `ai_provider` stays null. The count is reported as `aiUnavailable`.
- Per run: `maxAiCalls` (worker default 20 in `--once`, 15 otherwise) and an `aiTimeBudgetMs` wall clock.

## Idempotency and re-scoring

`job_matches` is unique on `(job_id, user_id, profile_version)`. A run only considers jobs with no row at the user's **current** `profile_version`, so:

- re-running is free and safe — already-scored jobs are skipped;
- editing a profile or preferences bumps `users.profile_version`, which re-scores everything against the new profile;
- previous versions' rows are kept, so a score can be explained after the fact.

Scores are flushed every 50 jobs or every 60 seconds (D51), so a run that dies part-way keeps its progress and simply resumes where it stopped.

## Operating it

```bash
pnpm --filter @jobsentinel/api build
pnpm --filter @jobsentinel/api match                      # all users, deterministic only
pnpm --filter @jobsentinel/api match --batch=300 --ai=12  # with AI refinement
pnpm --filter @jobsentinel/api match --user=<uuid>        # one user
```

The worker runs the same stage every tick (`match`, after `recheck`). `--ai=0` is the default for the CLI because AI calls are the only part of this stage that costs anything.

## Limits worth knowing

- Scores are only as good as the profile. A resume parsed into four skills will under-match everything; the onboarding confirmation step exists for exactly this reason.
- Skill matching is dictionary-based. A skill outside `packages/config/src/taxonomy/skills.ts` is compared as a literal string, so it matches only an exact spelling — the AI path is what covers the rest.
- The scorer has no notion of salary or company quality. Both are recorded but deliberately do not influence the score.
