import { test, expect } from '@playwright/test';
import { briefOpeningGoal, briefPointerPath, opensAsRequest } from '../src/lib/sessionTranscript';

const pointer = 'Read /synthetic/child-tasks/termfleet-helper-v1-12345678-1234-4234-8234-123456789abc.md and carry out the instructions in it.';

test('marked helper filenames preserve goal and pointer readers without visible origin text', () => {
 const task = `Goal: Fix the slow requests\nFull instructions: ${pointer}`;
 expect(briefOpeningGoal(task)).toBe('Fix the slow requests');
 expect(opensAsRequest(task)).toBe('Fix the slow requests');
 expect(briefPointerPath(task)).toBe('/synthetic/child-tasks/termfleet-helper-v1-12345678-1234-4234-8234-123456789abc.md');
});

test('a marked bare pointer still supplies no invented goal', () => {
 expect(opensAsRequest(pointer)).toBeUndefined();
 expect(briefOpeningGoal(pointer)).toBeUndefined();
});
