import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const SCRIPT_PATH = fileURLToPath(new URL("./reload_all_sessions.py", import.meta.url));
const STATUS_KEY = "herdr-reload-all";
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const EXECUTION_TIMEOUT_MS = 3 * 60 * 1000;

type ReloadCounts = {
  total: number;
  submitted: number;
  failed: number;
  scheduled: number;
  local: number;
  skipped: number;
};

type ReloadSummary = {
  runDir: string;
  counts: ReloadCounts;
};

type BackendResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

function runBackend(localPane: string): Promise<BackendResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "python3",
      [SCRIPT_PATH, "--execute", "--local-pane", localPane],
      {
        encoding: "utf8",
        maxBuffer: MAX_OUTPUT_BYTES,
        timeout: EXECUTION_TIMEOUT_MS,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ exitCode: 0, stdout, stderr });
          return;
        }

        if (typeof error.code === "number") {
          resolve({ exitCode: error.code, stdout, stderr });
          return;
        }

        reject(error);
      },
    );
  });
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseSummary(stdout: string): ReloadSummary | undefined {
  let value: unknown;
  try {
    value = JSON.parse(stdout.trim());
  } catch {
    return undefined;
  }

  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  if (typeof candidate.runDir !== "string" || !candidate.counts || typeof candidate.counts !== "object") {
    return undefined;
  }

  const counts = candidate.counts as Record<string, unknown>;
  const keys: Array<keyof ReloadCounts> = [
    "total",
    "submitted",
    "failed",
    "scheduled",
    "local",
    "skipped",
  ];
  if (!keys.every((key) => isFiniteNumber(counts[key]))) {
    return undefined;
  }

  return {
    runDir: candidate.runDir,
    counts: counts as ReloadCounts,
  };
}

function errorDetail(result: BackendResult): string {
  const detail = result.stderr.trim() || result.stdout.trim() || `Exit-Code ${result.exitCode}`;
  return detail.length > 600 ? `${detail.slice(0, 600)}…` : detail;
}

export default function herdrReloadAll(pi: ExtensionAPI) {
  let running = false;

  pi.registerCommand("reload-all", {
    description: "Alle laufenden Pi-Sessions sicher neu laden",
    handler: async (args, ctx) => {
      if (args.trim()) {
        ctx.ui.notify("Verwendung: /reload-all (keine Parameter)", "warning");
        return;
      }

      if (running) {
        ctx.ui.notify("Ein Herdr-Reload läuft bereits.", "warning");
        return;
      }

      const localPane = process.env.HERDR_PANE_ID?.trim();
      if (!localPane) {
        ctx.ui.notify("HERDR_PANE_ID fehlt. Der Befehl kann nur in einer Herdr-Pi-Session sicher ausgeführt werden.", "error");
        return;
      }

      running = true;
      ctx.ui.setStatus(STATUS_KEY, "Herdr: lade Pi-Sessions neu …");

      let result: BackendResult;
      try {
        result = await runBackend(localPane);
      } catch (error) {
        running = false;
        ctx.ui.setStatus(STATUS_KEY, undefined);
        const detail = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Herdr-Reload konnte nicht gestartet werden: ${detail}`, "error");
        return;
      }

      const summary = parseSummary(result.stdout);
      if (!summary) {
        running = false;
        ctx.ui.setStatus(STATUS_KEY, undefined);
        ctx.ui.notify(`Herdr-Reload fehlgeschlagen: ${errorDetail(result)}`, "error");
        return;
      }

      running = false;
      ctx.ui.setStatus(STATUS_KEY, undefined);

      const counts = summary.counts;
      const notificationType = counts.failed > 0 || counts.skipped > 0 || result.exitCode !== 0
        ? "warning"
        : "info";
      ctx.ui.notify(
        `Herdr-Reload: ${counts.total} gesamt, ${counts.submitted} sofort, ${counts.scheduled} zurückgestellt, `
          + `${counts.local} lokal, ${counts.skipped} übersprungen, ${counts.failed} fehlgeschlagen.\n`
          + `Run-Verzeichnis: ${summary.runDir}\nDiese Session wird jetzt lokal neu geladen.`,
        notificationType,
      );

      // Terminal action: all other panes were handled by the backend; reload this pane natively.
      await ctx.reload();
      return;
    },
  });
}
