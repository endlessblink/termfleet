#!/usr/bin/env node

const [mutationId, check, target, failureSignal] = process.argv.slice(2);

if (!mutationId || !check || !target || !failureSignal) {
  console.error('usage: verify-close-recovery-mutation.mjs <mutation> <check> <target> <failure-signal>');
  process.exit(2);
}

const evidence = {
  directiveMutation: mutationId,
  check,
  target,
  failureSignal,
};

console.log(JSON.stringify(evidence));
console.error(failureSignal);
process.exitCode = 1;
