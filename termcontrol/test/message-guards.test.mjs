import { test } from 'node:test';
import assert from 'node:assert/strict';
import { messageProblem, structureProblem } from '../bridge/requirements.mjs';

test('messageProblem: detects hollow messages', (t) => {
  // Hollow patterns - Hebrew
  assert.ok(messageProblem('כל שלושת הפריטים טופלו.'), 'should detect Hebrew "טופל"');
  assert.ok(messageProblem('הכל בוצע.'), 'should detect Hebrew "בוצע"');
  assert.ok(messageProblem('סיימתי.'), 'should detect Hebrew "סיימתי"');

  // Hollow patterns - English
  assert.ok(messageProblem('all items taken'), 'should detect "all items taken"');
  assert.ok(messageProblem('all done.'), 'should detect "all done"');
  assert.ok(messageProblem('everything handled'), 'should detect "everything handled"');
  assert.ok(messageProblem('completed'), 'should detect "completed"');
  assert.ok(messageProblem('handled'), 'should detect "handled"');
  assert.ok(messageProblem('done with.'), 'should detect "done with"');
  assert.ok(messageProblem('Done, with nothing to add.'), 'should detect "Done" at start with "nothing to add"');
  assert.ok(messageProblem('Done.'), 'should detect "Done" alone at start');

  // With evidence - should NOT be hollow
  assert.equal(messageProblem('הבדיקות הוקמו ב-09:00 ו-15:00. כל הטרמינלים ירוקים (19-45%). watchpost חי.'), null, 'should allow messages with numbers/percentages');
  assert.equal(messageProblem('Tests passed with 95% coverage on all modules.'), null, 'should allow messages with numbers as evidence');

  // With structured elements - should NOT be hollow
  assert.equal(messageProblem('Done.\n[question]\nShould I proceed?'), null, 'should allow messages with [question] blocks');
  assert.equal(messageProblem('✓ All done.\n[checklist]\n- Item 1\n- Item 2'), null, 'should allow messages with [checklist] blocks');

  // Long messages with content - should NOT be hollow
  const longMessage = `Completed the analysis. Here is the full breakdown:\n\nThe system checks show everything is green. Terminal 1 status: healthy. Terminal 2 status: healthy. All processes are running normally with no errors detected. The network connectivity is stable across all nodes. Performance metrics are within expected ranges.`;
  assert.equal(messageProblem(longMessage), null, 'should allow long messages with substantive content');

  // Short but acceptable messages
  assert.equal(messageProblem('This is a short message with some details about what was done.'), null, 'should allow short messages with details');

  // Empty or whitespace
  assert.equal(messageProblem(''), null, 'should not flag empty messages');
  assert.equal(messageProblem('   '), null, 'should not flag whitespace-only messages');
});

test('messageProblem: detects only-claims messages', (t) => {
  // Messages with ONLY completion claims (no details, no structure)
  assert.ok(messageProblem('כל שלושת הפריטים טופלו וכל עבודה הושלמה.'), 'should detect messages with only Hebrew claims');
  assert.ok(messageProblem('Done. All done. Everything handled.'), 'should detect messages with only English claims');
});

test('structureProblem: detects poor structure', (t) => {
  // Long single paragraph without breaks - PROBLEM
  const longParagraph = 'This is a very long message that goes on and on without any line breaks or bullet points to separate ideas. It contains a lot of text all mashed together in one single paragraph which makes it really hard to read and understand the different concepts being discussed. The reader has to parse through all of this without any visual separation between different topics or ideas. This is definitely a structural problem that should be fixed.';
  assert.ok(structureProblem(longParagraph), 'should detect long single paragraph');

  // Short message - NOT a problem
  assert.equal(structureProblem('short msg'), null, 'should not flag short messages');
  assert.equal(structureProblem('This is a short single paragraph.'), null, 'should not flag short single paragraph');

  // Long text with line breaks - NOT a problem
  const withLineBreaks = `This is a long message that uses line breaks properly.
It has multiple lines which makes it easier to read.
Each line conveys a different thought or idea.
This is the correct way to structure a long message.`;
  assert.equal(structureProblem(withLineBreaks), null, 'should allow long messages with line breaks');

  // Long text with bullet points - NOT a problem
  const withBullets = `Here are the key points:
- First point is important
- Second point matters too
- Third point should not be overlooked
- Fourth point completes the list`;
  assert.equal(structureProblem(withBullets), null, 'should allow long messages with bullets');

  // Long text with headers - NOT a problem
  const withHeaders = `# Main Topic
Content here about the main topic.

## Subtopic 1
More details about the first subtopic.

## Subtopic 2
Additional information about the second subtopic.`;
  assert.equal(structureProblem(withHeaders), null, 'should allow long messages with headers');
});

test('structureProblem: edge cases', (t) => {
  // Exactly 200 chars
  const msg200 = 'x'.repeat(200);
  assert.equal(structureProblem(msg200), null, 'should not flag exactly 200 chars without structure requirement');

  // Just over 200 chars with no structure
  const msg201 = 'x'.repeat(201);
  assert.ok(structureProblem(msg201), 'should flag 201 chars as single paragraph');

  // Over 200 with newline
  const msg201WithNewline = 'x'.repeat(100) + '\n' + 'y'.repeat(101);
  assert.equal(structureProblem(msg201WithNewline), null, 'should allow 201+ chars with newline');
});
