# Private workspace service examples

These user units require an operator-owned configuration file at
`~/.config/termfleet/workspace-access.env`. Configure absolute paths and the
exact private HTTPS origins before installing them:

```ini
TERMFLEET_SOURCE=/opt/termfleet
IMAGINEBOX_SOURCE=/opt/imaginebox/source
IMAGINEBOX_PROJECT=/opt/imaginebox/projects/example.film
WORKSPACE_ORIGIN=https://workspace.example.ts.net:8810
STUDIO_ORIGIN=https://workspace.example.ts.net:8812
```

Keep the configuration local and private. Node must be on the user service's
PATH. The application entrypoint must resolve its resources independently of
the service working directory. Verify this before installing the units.
The origins must match the configured private Serve routes. Do not use a
public proxy or Funnel. Missing configuration prevents service startup.

These portable examples do not alter any already installed user units.
