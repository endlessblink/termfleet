const [mutation, check, target] = process.argv.slice(2);
if (!mutation || !check || !target) {
  console.error('mutation arguments required');
  process.exit(2);
}
console.error('invariant failed');
console.log(JSON.stringify({directiveMutation: mutation, check, target, failureSignal: 'invariant failed'}));
process.exit(1);
