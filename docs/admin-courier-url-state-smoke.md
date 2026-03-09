# Admin courier URL-state smoke test

## Goal
Verify that `/admin/courier` preserves and reflects query-string state for `unassigned` and `page`.

## Manual steps
1. Open `/admin/courier?unassigned=0&page=2`.
2. Confirm UI shows non-unassigned view and page index 2.
3. Toggle **Show only unassigned** and confirm URL updates to `unassigned=1&page=1`.
4. Click **Next** and confirm `page` increments in URL.
5. Reload browser and confirm state is retained from URL values.

## Expected outcome
- URL and UI state remain synchronized with no first-load overwrite.
- Paging/filter controls remain stable after refresh.
