'use client';

import { useState } from 'react';
import { useFilterParams } from '@/hooks/useFilterParams';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { PostingType } from '@/lib/types/jobs';

// One list per control feeds both the options and Base UI's `items`, which is what lets the
// closed trigger show "Newest First" instead of the raw value `newest`.
const SORT_ITEMS = [
  { value: 'newest', label: 'Newest First' },
  { value: 'score', label: 'Best Match' },
  { value: 'posted', label: 'Recently Posted' },
];
const POSTED_ITEMS = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '60d', label: 'Last 60 days' },
];
const STATUS_ITEMS = [
  { value: 'ACTIVE', label: 'Active Jobs' },
  { value: 'ALL', label: 'All Jobs' },
  { value: 'EXPIRED', label: 'Expired Jobs' },
];
const VERIFICATION_ITEMS = [
  { value: 'VERIFIED', label: 'Verified only' },
  { value: 'INCLUDE_UNCONFIRMED', label: 'Include unconfirmed' },
];
const POSTING_TYPE_ITEMS: { value: PostingType; label: string }[] = [
  { value: 'CAMPUS_DRIVE', label: 'Campus drive' },
  { value: 'OFF_CAMPUS_PROGRAM', label: 'Off-campus programme' },
  { value: 'REGULAR', label: 'Regular opening' },
];

function Options({ items }: { items: { value: string; label: string }[] }) {
  return (
    <SelectContent>
      {items.map((item) => (
        <SelectItem key={item.value} value={item.value}>
          {item.label}
        </SelectItem>
      ))}
    </SelectContent>
  );
}

export function JobFilters() {
  const { query, updateFilter, setQuery } = useFilterParams();
  // Captured once, in a state initializer, so render stays pure.
  const [mountedAt] = useState(() => Date.now());

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-row items-center justify-between pb-4">
        <CardTitle className="text-lg">Filters</CardTitle>
        <Button variant="ghost" size="sm" onClick={() => setQuery({})}>
          Clear All
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="search">Search</Label>
          <Input
            id="search"
            placeholder="Job title, skills..."
            value={query.q || ''}
            onChange={(e) => updateFilter('q', e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="filter-sort">Sort By</Label>
          <Select
            items={SORT_ITEMS}
            value={query.sort || 'newest'}
            onValueChange={(val) => updateFilter('sort', val)}
          >
            <SelectTrigger id="filter-sort" className="w-full">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <Options items={SORT_ITEMS} />
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="filter-posted">Date Posted</Label>
          <Select
            items={POSTED_ITEMS}
            value={(() => {
              if (!query.postedAfter) return '60d';
              // `mountedAt`, not `Date.now()`: reading the clock during render is impure, and the
              // only use here is bucketing into 7/30/60, where a few hours of drift cannot change
              // the answer.
              const days = Math.round(
                (mountedAt - new Date(query.postedAfter).getTime()) / 86400000,
              );
              if (days <= 7) return '7d';
              if (days <= 30) return '30d';
              return '60d';
            })()}
            onValueChange={(val) => {
              if (val === '60d') updateFilter('postedAfter', undefined);
              else if (val === '30d') {
                const date = new Date();
                date.setDate(date.getDate() - 30);
                updateFilter('postedAfter', date.toISOString());
              } else if (val === '7d') {
                const date = new Date();
                date.setDate(date.getDate() - 7);
                updateFilter('postedAfter', date.toISOString());
              }
            }}
          >
            <SelectTrigger id="filter-posted" className="w-full">
              <SelectValue placeholder="Date Posted" />
            </SelectTrigger>
            <Options items={POSTED_ITEMS} />
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="filter-status">Status</Label>
          <Select
            items={STATUS_ITEMS}
            value={query.status || 'ACTIVE'}
            onValueChange={(val) => updateFilter('status', val)}
          >
            <SelectTrigger id="filter-status" className="w-full">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <Options items={STATUS_ITEMS} />
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="filter-verification">Verification</Label>
          <Select
            items={VERIFICATION_ITEMS}
            value={
              (query.validationStatus ?? []).includes('NEEDS_REVIEW')
                ? 'INCLUDE_UNCONFIRMED'
                : 'VERIFIED'
            }
            onValueChange={(val) =>
              // Omitting the param falls back to the API's default of VALID only (docs 03 §3).
              updateFilter(
                'validationStatus',
                val === 'VERIFIED' ? undefined : ['VALID', 'NEEDS_REVIEW'],
              )
            }
          >
            <SelectTrigger id="filter-verification" className="w-full">
              <SelectValue placeholder="Verification" />
            </SelectTrigger>
            <Options items={VERIFICATION_ITEMS} />
          </Select>
          <p className="text-xs text-muted-foreground">
            Unconfirmed jobs are usually real — their careers page blocked our check. Each one shows
            the evidence we gathered.
          </p>
        </div>

        {/* Salary filter (R6, D111) */}
        <div className="space-y-2">
          <Label htmlFor="salary-min-input">Minimum Salary (₹/year)</Label>
          <Input
            id="salary-min-input"
            data-testid="salary-min-input"
            type="number"
            min={0}
            step={50000}
            placeholder="e.g. 500000"
            value={query.salaryMin ?? ''}
            onChange={(e) => {
              const val = e.target.value.trim();
              const num = val === '' ? undefined : Number(val);
              updateFilter('salaryMin', num !== undefined && !isNaN(num) ? num : undefined);
            }}
          />
          <div className="flex items-center space-x-2 pt-1">
            <input
              id="salary-undisclosed-toggle"
              data-testid="salary-undisclosed-toggle"
              type="checkbox"
              checked={query.includeUndisclosedSalary !== false}
              // Only meaningful with a minimum: without one the API ignores it (D111), and the
              // hook drops it, so an enabled box would silently re-check itself.
              disabled={query.salaryMin === undefined}
              onChange={(e) => {
                const checked = e.target.checked;
                if (checked) {
                  updateFilter('includeUndisclosedSalary', undefined);
                } else {
                  // Send false when unchecked (R6, D111)
                  updateFilter('includeUndisclosedSalary', false);
                }
              }}
              className="size-4 cursor-pointer rounded border-input text-primary focus:ring-primary"
            />
            <Label
              htmlFor="salary-undisclosed-toggle"
              className="cursor-pointer text-xs font-normal text-muted-foreground"
            >
              Include jobs that don&apos;t state a salary
            </Label>
          </div>
        </div>

        {/* Posting type filter (D114) */}
        <div data-testid="posting-type-filter" className="space-y-2">
          <Label>Posting Type</Label>
          <div className="flex flex-col gap-2">
            {POSTING_TYPE_ITEMS.map((item) => {
              const isSelected = (query.postingType ?? []).includes(item.value);
              return (
                <label key={item.value} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={(e) => {
                      const current = query.postingType ?? [];
                      const updated = e.target.checked
                        ? [...current, item.value]
                        : current.filter((v) => v !== item.value);
                      updateFilter('postingType', updated.length > 0 ? updated : undefined);
                    }}
                    className="size-4 cursor-pointer rounded border-input text-primary focus:ring-primary"
                  />
                  <span>{item.label}</span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <Switch
            id="remote"
            checked={query.remote === true}
            onCheckedChange={(checked) => updateFilter('remote', checked || undefined)}
          />
          <Label htmlFor="remote">Remote Only</Label>
        </div>

        <div className="flex items-center space-x-2">
          <Switch
            id="saved"
            checked={query.saved === true}
            onCheckedChange={(checked) => updateFilter('saved', checked || undefined)}
          />
          <Label htmlFor="saved">Saved Jobs</Label>
        </div>
      </CardContent>
    </Card>
  );
}
