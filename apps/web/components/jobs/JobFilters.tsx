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
