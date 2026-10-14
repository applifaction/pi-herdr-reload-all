# pi-herdr-reload-all

Reload every live [Pi](https://github.com/earendil-works/pi) session managed by Herdr with one deterministic command.

`/reload-all` safely fans out Pi's `/reload` command without starting an LLM turn. Idle sessions reload immediately, active sessions reload after they settle, and the session that launched the command reloads itself through Pi's native extension API.

## Why

Reloading every Pi pane manually is slow and error-prone, especially when some sessions are still working. This extension coordinates the reload through Herdr while preserving active turns and reporting exactly what happened.

## Requirements

- Pi with extension command support
- Herdr with its Pi integration enabled
- `herdr` available on `PATH`
- Python 3.10 or newer

> [!IMPORTANT]
> The command must run inside a Herdr-managed Pi pane. It deliberately aborts when `HERDR_PANE_ID` is unavailable or the current pane cannot be found in Herdr's Pi session list.

## Install

Install the repository as a personal Pi package:

```bash
pi install git:github.com/applifaction/pi-herdr-reload-all
```

Reload Pi once so the command becomes available:

```text
/reload
```

To update or remove it later:

```bash
pi update git:github.com/applifaction/pi-herdr-reload-all
pi remove git:github.com/applifaction/pi-herdr-reload-all
```

## Usage

Run the command without parameters:

```text
/reload-all
```

There is no preview step. The command immediately submits or schedules `/reload` for every Pi session returned by `herdr agent list`.

## How it works

| Session state | Action |
| --- | --- |
| Current pane | Excluded from remote prompts, then reloaded with `ctx.reload()` |
| `idle` or `done` | Receives `/reload` immediately through `herdr agent prompt` |
| `working` or `blocked` | Gets a detached worker that waits for `idle` or `done`, then submits `/reload` |
| Unknown state | Skipped and reported |

Remote submissions use bounded concurrency. Deferred workers wait up to 30 minutes by default, survive the initiating session's reload, and write their own result files.

> [!NOTE]
> The extension uses Herdr's agent prompt API rather than terminal key injection. It never steers `/reload` into a session that Herdr currently reports as active.

## Run artifacts

Each invocation creates a timestamped directory under:

```text
~/.local/state/herdr-reload-all/
```

The directory contains:

- `summary.json` — totals and immediate outcomes
- `<pane>.result.json` — final result for a deferred pane
- `<pane>.worker.log` — detached worker output

The Pi notification reports the totals and the exact run directory.

## Development

Clone the repository and load the extension directly:

```bash
git clone git@github.com:applifaction/pi-herdr-reload-all.git
cd pi-herdr-reload-all
pi --no-extensions --extension ./extensions/herdr-reload-all/index.ts
```

Pi loads the TypeScript source through `jiti`; no build step is required. The Python backend uses only the standard library.

Project layout:

```text
.
├── extensions/
│   └── herdr-reload-all/
│       ├── index.ts
│       └── reload_all_sessions.py
├── .gitignore
├── package-lock.json
├── package.json
└── README.md
```
