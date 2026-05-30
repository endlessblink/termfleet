#!/usr/bin/env bash
set -euo pipefail

missing=0

if ldconfig -p 2>/dev/null | grep -q 'libvte-2.91.so.0' ||
  [[ -e /usr/lib/x86_64-linux-gnu/libvte-2.91.so.0 ]] ||
  [[ -e /usr/lib/libvte-2.91.so.0 ]] ||
  [[ -e /lib/x86_64-linux-gnu/libvte-2.91.so.0 ]] ||
  [[ -e /lib/libvte-2.91.so.0 ]]; then
  echo "native-terminal runtime: libvte-2.91.so.0 found"
else
  echo "native-terminal runtime missing: install libvte-2.91-0" >&2
  missing=1
fi

if pkg-config --exists vte-2.91; then
  echo "native-terminal VTE pkg-config metadata: vte-2.91.pc found ($(pkg-config --modversion vte-2.91))"
else
  echo "native-terminal VTE pkg-config metadata: missing; runtime symbol loading will use libvte-2.91.so.0"
fi

if pkg-config --exists gtk+-3.0; then
  echo "native-terminal GTK package: gtk+-3.0 found ($(pkg-config --modversion gtk+-3.0))"
else
  echo "native-terminal GTK package missing: install libgtk-3-dev" >&2
  missing=1
fi

exit "$missing"
