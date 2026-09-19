import { FormEvent, useEffect, useMemo, useState } from "react";
import AppShell from "../components/AppShell";
import {
  api,
  type ImportBatch,
  type ImportBatchesResponse,
  type ImportCommitResponse,
  type ImportMapResponse,
  type ImportPreviewResponse,
  type ImportTargetField,
  type ImportUploadResponse,
  type MeResponse,
} from "../lib/api";

type Props = { me: MeResponse; onLogout: () => void };

type Tab = "new" | "history";
type Step = "upload" | "map" | "preview" | "done";

const SKIP = "__skip__";

export default function ImportPage({ me, onLogout }: Props) {
  const canImport =
    me.active?.role === "owner" || me.active?.role === "admin";
  const [tab, setTab] = useState<Tab>("new");
  const [step, setStep] = useState<Step>("upload");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [xlsxBase64, setXlsxBase64] = useState("");
  const [batch, setBatch] = useState<ImportBatch | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [sampleRows, setSampleRows] = useState<string[][]>([]);
  const [targetFields, setTargetFields] = useState<ImportTargetField[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [commitResult, setCommitResult] = useState<ImportCommitResponse | null>(
    null,
  );
  const [history, setHistory] = useState<ImportBatchesResponse | null>(null);

  async function loadHistory() {
    const body = await api<ImportBatchesResponse>("/api/import/batches");
    setHistory(body);
  }

  useEffect(() => {
    if (!canImport) return;
    loadHistory().catch((err) =>
      setError(err instanceof Error ? err.message : "Could not load history"),
    );
  }, [canImport]);

  const mappedCount = useMemo(
    () => Object.values(mapping).filter((v) => v && v !== SKIP).length,
    [mapping],
  );

  async function onPickFile(file: File) {
    setError("");
    setFileName(file.name);
    setCsvText("");
    setXlsxBase64("");
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      bytes.forEach((b) => {
        binary += String.fromCharCode(b);
      });
      setXlsxBase64(btoa(binary));
      return;
    }
    setCsvText(await file.text());
  }

  async function onUpload(event: FormEvent) {
    event.preventDefault();
    if (!fileName || (!csvText && !xlsxBase64)) {
      setError("Choose a CSV or Excel file first.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const body = await api<ImportUploadResponse>("/api/import/upload", {
        method: "POST",
        body: JSON.stringify({
          fileName,
          csv: csvText || undefined,
          xlsxBase64: xlsxBase64 || undefined,
        }),
      });
      setBatch(body.batch);
      setHeaders(body.headers);
      setSampleRows(body.sampleRows);
      setTargetFields(body.targetFields);
      const next: Record<string, string> = {};
      for (const header of body.headers) next[header] = SKIP;
      setMapping(next);
      setPreview(null);
      setCommitResult(null);
      setStep("map");
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function onMap(event: FormEvent) {
    event.preventDefault();
    if (!batch) return;
    setBusy(true);
    setError("");
    try {
      const mappings = headers.map((sourceColumn) => ({
        sourceColumn,
        targetField: mapping[sourceColumn] || SKIP,
      }));
      const body = await api<ImportMapResponse>(
        `/api/import/batches/${batch.id}/map`,
        {
          method: "POST",
          body: JSON.stringify({ mappings }),
        },
      );
      setBatch(body.batch);
      setStep("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mapping failed");
    } finally {
      setBusy(false);
    }
  }

  async function onPreview() {
    if (!batch) return;
    setBusy(true);
    setError("");
    try {
      const body = await api<ImportPreviewResponse>(
        `/api/import/batches/${batch.id}/preview`,
        { method: "POST", body: JSON.stringify({}) },
      );
      setPreview(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setBusy(false);
    }
  }

  async function onCommit() {
    if (!batch) return;
    if (!confirm("Write these rows to this practice? This cannot be undone from the import screen.")) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const body = await api<ImportCommitResponse>(
        `/api/import/batches/${batch.id}/commit`,
        { method: "POST", body: JSON.stringify({}) },
      );
      setCommitResult(body);
      setBatch(body.batch);
      setStep("done");
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Commit failed");
    } finally {
      setBusy(false);
    }
  }

  function resetWizard() {
    setStep("upload");
    setBatch(null);
    setHeaders([]);
    setSampleRows([]);
    setMapping({});
    setPreview(null);
    setCommitResult(null);
    setFileName("");
    setCsvText("");
    setXlsxBase64("");
  }

  if (!canImport) {
    return (
      <AppShell me={me} onLogout={onLogout}>
        <h2 className="text-2xl font-semibold">Import</h2>
        <p className="text-sm text-ink-500">
          CSV / Excel import is limited to owner and admin. Ask an owner if you
          need historical Daily Log or patient rows loaded.
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell me={me} onLogout={onLogout}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Import</h2>
          <p className="text-sm text-ink-500">
            Generic CSV or Excel only. Map columns yourself, preview a dry run,
            then confirm. Raw rows expire after 30 days. ChiroTouch parsers and
            OpenAI mapping are not available.
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          <button
            type="button"
            className={
              tab === "new"
                ? "rounded-lg bg-clinical-100 text-clinical-700 px-3 py-1.5 font-medium"
                : "rounded-lg px-3 py-1.5 text-ink-500 hover:bg-slate-50"
            }
            onClick={() => setTab("new")}
          >
            New import
          </button>
          <button
            type="button"
            className={
              tab === "history"
                ? "rounded-lg bg-clinical-100 text-clinical-700 px-3 py-1.5 font-medium"
                : "rounded-lg px-3 py-1.5 text-ink-500 hover:bg-slate-50"
            }
            onClick={() => {
              setTab("history");
              loadHistory().catch((err) =>
                setError(err instanceof Error ? err.message : "History failed"),
              );
            }}
          >
            History
          </button>
        </div>
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      {tab === "history" ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
          {!history || history.batches.length === 0 ? (
            <p className="text-sm text-ink-500">No import batches yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink-500">
                  <th className="py-2">File</th>
                  <th>Status</th>
                  <th>Rows</th>
                  <th>Expires</th>
                </tr>
              </thead>
              <tbody>
                {history.batches.map((item) => (
                  <tr key={item.id} className="border-t border-slate-100">
                    <td className="py-2">{item.fileName}</td>
                    <td>{item.status}</td>
                    <td>
                      {item.successRows}/{item.totalRows}
                    </td>
                    <td className="text-ink-500">
                      {item.rawExpiresAt.slice(0, 10)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : (
        <div className="space-y-4">
          <ol className="flex flex-wrap gap-2 text-xs text-ink-500">
            {(["upload", "map", "preview", "done"] as Step[]).map((item) => (
              <li
                key={item}
                className={
                  item === step
                    ? "rounded-full bg-clinical-100 text-clinical-700 px-2 py-0.5 font-medium"
                    : "rounded-full bg-slate-100 px-2 py-0.5"
                }
              >
                {item}
              </li>
            ))}
          </ol>

          {step === "upload" ? (
            <form
              onSubmit={(e) => void onUpload(e)}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-card space-y-3"
            >
              <label className="block text-sm">
                Spreadsheet
                <input
                  type="file"
                  accept=".csv,.txt,.xlsx,.xls"
                  className="mt-1 block"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void onPickFile(file);
                  }}
                />
              </label>
              {fileName ? (
                <p className="text-sm text-ink-500">Selected: {fileName}</p>
              ) : null}
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-clinical-700 text-white px-3 py-1.5 text-sm disabled:opacity-50"
              >
                {busy ? "Uploading…" : "Upload"}
              </button>
            </form>
          ) : null}

          {step === "map" && batch ? (
            <form
              onSubmit={(e) => void onMap(e)}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-card space-y-3"
            >
              <p className="text-sm">
                Map each column to a Daily Log or Patients field. Unmapped
                columns are skipped.
              </p>
              <div className="space-y-2">
                {headers.map((header) => (
                  <label key={header} className="flex flex-col sm:flex-row sm:items-center gap-2 text-sm">
                    <span className="sm:w-40 font-medium truncate">{header}</span>
                    <select
                      className="rounded-lg border border-slate-200 px-2 py-1.5"
                      value={mapping[header] ?? SKIP}
                      onChange={(e) =>
                        setMapping((prev) => ({
                          ...prev,
                          [header]: e.target.value,
                        }))
                      }
                    >
                      <option value={SKIP}>Skip this column</option>
                      {targetFields.map((field) => (
                        <option key={field.value} value={field.value}>
                          {field.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              {sampleRows.length > 0 ? (
                <div className="overflow-x-auto text-xs">
                  <p className="text-ink-500 mb-1">
                    Sample (emails/phones masked before mapping is known)
                  </p>
                  <table className="min-w-full">
                    <thead>
                      <tr>
                        {headers.map((h) => (
                          <th key={h} className="text-left pr-3 py-1">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sampleRows.map((row, i) => (
                        <tr key={i} className="border-t border-slate-100">
                          {row.map((cell, j) => (
                            <td key={j} className="pr-3 py-1">
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              <button
                type="submit"
                disabled={busy || mappedCount === 0}
                className="rounded-lg bg-clinical-700 text-white px-3 py-1.5 text-sm disabled:opacity-50"
              >
                {busy ? "Saving map…" : "Save mapping"}
              </button>
            </form>
          ) : null}

          {step === "preview" && batch ? (
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-card space-y-3">
              <p className="text-sm">
                Dry run. Preview does not write Daily Log or Patients rows.
              </p>
              <button
                type="button"
                disabled={busy}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                onClick={() => void onPreview()}
              >
                {busy && !preview ? "Previewing…" : "Run preview"}
              </button>
              {preview ? (
                <div className="space-y-2 text-sm">
                  <p>
                    Valid {preview.counts.validCount} · errors{" "}
                    {preview.counts.errorCount} · skipped{" "}
                    {preview.counts.skippedCount} · daily log{" "}
                    {preview.counts.dailyLogCreates} · patients{" "}
                    {preview.counts.patientCreates}
                    {preview.counts.anomalyWarnings > 0
                      ? ` · ${preview.counts.anomalyWarnings} revenue-without-visits warnings`
                      : ""}
                  </p>
                  <div className="overflow-x-auto text-xs">
                    <table className="min-w-full">
                      <thead>
                        <tr>
                          <th className="text-left pr-3 py-1">Row</th>
                          {preview.headers.map((h) => (
                            <th key={h} className="text-left pr-3 py-1">
                              {h}
                            </th>
                          ))}
                          <th className="text-left">Flags</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.sample.map((row) => (
                          <tr key={row.rowNumber} className="border-t border-slate-100">
                            <td className="pr-3 py-1">{row.rowNumber}</td>
                            {row.cells.map((cell, i) => (
                              <td key={i} className="pr-3 py-1">
                                {cell}
                              </td>
                            ))}
                            <td>
                              {row.errors.join(", ") ||
                                row.warnings.join(", ") ||
                                "ok"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <button
                    type="button"
                    disabled={busy || preview.counts.validCount === 0}
                    className="rounded-lg bg-clinical-700 text-white px-3 py-1.5 text-sm disabled:opacity-50"
                    onClick={() => void onCommit()}
                  >
                    {busy ? "Writing…" : "Confirm and write"}
                  </button>
                </div>
              ) : null}
            </section>
          ) : null}

          {step === "done" && commitResult ? (
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-card space-y-3">
              <p className="text-sm">
                Wrote {commitResult.counts.successRows} rows
                {commitResult.counts.dailyLogCreates
                  ? ` (${commitResult.counts.dailyLogCreates} new daily log)`
                  : ""}
                {commitResult.counts.patientCreates
                  ? ` (${commitResult.counts.patientCreates} patients)`
                  : ""}
                . Errors {commitResult.counts.errorRows}, skipped{" "}
                {commitResult.counts.skippedRows}.
              </p>
              {commitResult.warnings.length > 0 ? (
                <p className="text-sm text-amber-800">
                  {commitResult.warnings.length} revenue-without-visits warning
                  {commitResult.warnings.length === 1 ? "" : "s"}.
                </p>
              ) : null}
              <button
                type="button"
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                onClick={resetWizard}
              >
                Import another file
              </button>
            </section>
          ) : null}
        </div>
      )}
    </AppShell>
  );
}
