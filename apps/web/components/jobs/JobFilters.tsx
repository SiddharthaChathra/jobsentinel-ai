'use client';

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

export function JobFilters() {
  const { query, updateFilter, setQuery } = useFilterParams();

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
          <Label>Sort By</Label>
          <Select value={query.sort || 'newest'} onValueChange={(val) => updateFilter('sort', val)}>
            <SelectTrigger>
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest First</SelectItem>
              <SelectItem value="score">Best Match</SelectItem>
              <SelectItem value="posted">Recently Posted</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Status</Label>
          <Select
            value={query.status || 'ACTIVE'}
            onValueChange={(val) => updateFilter('status', val)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ACTIVE">Active Jobs</SelectItem>
              <SelectItem value="ALL">All Jobs</SelectItem>
              <SelectItem value="EXPIRED">Expired Jobs</SelectItem>
            </SelectContent>
          </Select>
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
            id="fresher"
            checked={query.fresherOnly === true}
            onCheckedChange={(checked) => updateFilter('fresherOnly', checked || undefined)}
          />
          <Label htmlFor="fresher">Fresher / Entry Level Only</Label>
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
