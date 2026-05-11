# @carter-mcalister/pi-glimpse-url-app

macOS helper for opening Plannotator's local browser UI inside a native Glimpse window.

Plannotator launches custom browsers on macOS with `open -a "$PLANNOTATOR_BROWSER" "$url"`. This package installs a small `Glimpse URL.app` AppleScript app that receives the URL via macOS's `open location` event and forwards it to the `glimpse-url` Node launcher.

## Install

From the repo root:

```bash
bun install
bun run --cwd packages/pi-glimpse-url-app install-app
```

This creates:

- `~/.local/bin/glimpse-url`
- `~/Applications/Glimpse URL.app`

## Configure Fish

```fish
set -gx PLANNOTATOR_BROWSER "Glimpse URL"
```

## Smoke Test

```bash
open -a "Glimpse URL" "http://127.0.0.1:19432"
```

The app logs launcher output to `~/Library/Logs/glimpse-url.log`.
