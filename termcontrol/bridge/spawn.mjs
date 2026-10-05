// How a new agent is started from the phone/desktop page. It must join the
// project it was requested for (same row and group on the map), never appear
// as a loose card elsewhere.
export function spawnArgs({ project, cwd }, provider, taskFile) {
  return ['spawn', '--provider', provider, '--cwd', cwd, '--task-file', taskFile,
    '--title', `${project} · new ${provider}`, '--near', cwd];
}
