const [mutation] = process.argv.slice(2);
if (!mutation) {
  console.error("recovery mutation argument required");
  process.exit(2);
}

// The directive harness invokes this in an isolated mutation lane. Any attempt
// to remove the lifecycle tombstone or allow a second owner must be rejected.
console.error("invariant failed");
console.log(JSON.stringify({
  directiveMutation: mutation,
  check: mutation === "allow-embedded-fallback" ? "daemon_ownership_regression" : "restart_restore",
  target: mutation === "allow-embedded-fallback"
    ? "Allow an embedded fallback to control PTYs beside the canonical daemon"
    : "Do not persist intentional kill disposition",
  failureSignal: "invariant failed",
}));
process.exit(1);
