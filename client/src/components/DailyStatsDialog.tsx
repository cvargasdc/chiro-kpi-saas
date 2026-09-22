import { useEffect, useState, type KeyboardEvent } from "react";
import {
  api,
  ApiError,
  type MeResponse,
  type Patient,
  type ReferralSource,
} from "../lib/api";
import {
  buildDay2PatchPayload,
  buildPatientCreatePayload,
  emptyPatientDraft,
  localTodayYmd,
  type ReplitCareAnswer,
  type WizardPatientDraft,
} from "../lib/dailyStatsMapping";

type Props = {
  me: MeResponse;
  onComplete?: () => void;
};

type Step = 1 | 2 | 3 | 4 | 5;

type Day1Candidate = Pick<
  Patient,
  "id" | "name" | "day1Date" | "day2Date" | "referralSource" | "patientType"
>;

export default function DailyStatsDialog({ me, onComplete }: Props) {
  const canWrite = Boolean(me.active?.role && me.active.role !== "readonly");
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>(1);
  const [date, setDate] = useState(localTodayYmd());
  const [visits, setVisits] = useState("");
  const [newPatientsCount, setNewPatientsCount] = useState("");
  const [entries, setEntries] = useState<WizardPatientDraft[]>([]);
  const [dollars, setDollars] = useState("");
  const [sources, setSources] = useState<ReferralSource[]>([]);
  const [day1Candidates, setDay1Candidates] = useState<Day1Candidate[]>([]);
  const [searchQueries, setSearchQueries] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    api<{ sources: ReferralSource[] }>("/api/referral-sources")
      .then((body) => setSources(body.sources.filter((s) => s.active)))
      .catch(() => setSources([]));
    api<{ patients: Patient[] }>("/api/patients?limit=200")
      .then((body) => {
        setDay1Candidates(
          body.patients.filter((p) => p.day1Date && !p.day2Date),
        );
      })
      .catch(() => setDay1Candidates([]));
  }, [open]);

  useEffect(() => {
    const count = Math.max(0, parseInt(newPatientsCount, 10) || 0);
    if (count === entries.length) return;
    setEntries((prev) =>
      Array.from({ length: count }, (_, i) => prev[i] ?? emptyPatientDraft()),
    );
    setSearchQueries((prev) =>
      Array.from({ length: count }, (_, i) => prev[i] ?? ""),
    );
  }, [newPatientsCount, entries.length]);

  if (!canWrite) return null;

  function reset() {
    setStep(1);
    setDate(localTodayYmd());
    setVisits("");
    setNewPatientsCount("");
    setEntries([]);
    setDollars("");
    setSearchQueries([]);
    setSaving(false);
    setError("");
  }

  function close() {
    setOpen(false);
    reset();
  }

  function updateEntry(
    index: number,
    patch: Partial<WizardPatientDraft>,
  ) {
    setEntries((prev) => {
      const next = [...prev];
      const cur = { ...next[index], ...patch };
      if (patch.patientType === "wellness") {
        cur.appointmentType = "day1";
        cur.priorPatientId = null;
      }
      if (patch.appointmentType === "day1") {
        cur.priorPatientId = null;
        cur.careAnswer = null;
      }
      if (patch.appointmentType === "day2") {
        cur.name = "";
        cur.priorPatientId = null;
      }
      if (patch.patientType) {
        cur.careAnswer = null;
      }
      next[index] = cur;
      return next;
    });
  }

  function selectDay1(index: number, patient: Day1Candidate) {
    setEntries((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        name: patient.name,
        priorPatientId: patient.id,
        referralSource: patient.referralSource ?? next[index].referralSource,
        patientType:
          patient.patientType === "wellness" ? "wellness" : "new",
      };
      return next;
    });
  }

  function patientEntriesValid(): boolean {
    if (entries.length === 0) return true;
    return entries.every((e) => {
      if (!e.name.trim()) return false;
      if (e.patientType === "wellness") return e.careAnswer !== null;
      if (e.appointmentType === "day2") {
        return e.careAnswer !== null && (e.priorPatientId || e.name.trim());
      }
      return true;
    });
  }

  function totalSteps(): number {
    return (parseInt(newPatientsCount, 10) || 0) > 0 ? 4 : 3;
  }

  function displayStep(): number {
    if (step === 4) return totalSteps();
    if (step === 3) return 3;
    return step;
  }

  function handleNext() {
    setError("");
    if (step === 1 && visits !== "") {
      setStep(2);
      return;
    }
    if (step === 2) {
      if (newPatientsCount === "") return;
      const count = parseInt(newPatientsCount, 10) || 0;
      setStep(count > 0 ? 3 : 4);
      return;
    }
    if (step === 3 && patientEntriesValid()) {
      setStep(4);
      return;
    }
    if (step === 4 && dollars !== "") {
      void handleSubmit();
    }
  }

  function handleBack() {
    setError("");
    if (step === 4 && (parseInt(newPatientsCount, 10) || 0) === 0) {
      setStep(2);
      return;
    }
    setStep((s) => (s - 1) as Step);
  }

  async function upsertDailyLog(
    dateStr: string,
    visitsNum: number,
    revenue: number,
  ) {
    const payload = { visits: visitsNum, revenue };
    try {
      await api(`/api/daily-log/${dateStr}`);
      await api(`/api/daily-log/${dateStr}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        await api("/api/daily-log", {
          method: "POST",
          body: JSON.stringify({ date: dateStr, ...payload }),
        });
        return;
      }
      throw err;
    }
  }

  async function handleSubmit() {
    setSaving(true);
    setError("");
    try {
      const visitsNum = parseInt(visits, 10) || 0;
      const revenueNum = Number(dollars);
      if (!Number.isFinite(revenueNum) || revenueNum < 0) {
        throw new Error("Revenue must be ≥ 0");
      }
      await upsertDailyLog(date, visitsNum, revenueNum);

      for (const entry of entries) {
        if (
          entry.appointmentType === "day2" &&
          entry.priorPatientId &&
          entry.careAnswer
        ) {
          const patch = buildDay2PatchPayload(entry.careAnswer, date);
          await api(`/api/patients/${entry.priorPatientId}`, {
            method: "PATCH",
            body: JSON.stringify(patch),
          });
          continue;
        }
        const body = buildPatientCreatePayload(entry, date);
        await api("/api/patients", {
          method: "POST",
          body: JSON.stringify(body),
        });
      }

      setStep(5);
      setTimeout(() => {
        close();
        onComplete?.();
      }, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save daily stats");
      setSaving(false);
    }
  }

  function filteredDay1(q: string): Day1Candidate[] {
    if (!q.trim()) return day1Candidates;
    const needle = q.toLowerCase();
    return day1Candidates.filter((p) => p.name.toLowerCase().includes(needle));
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleNext();
    }
  }

  const nextDisabled =
    saving ||
    (step === 1 && visits === "") ||
    (step === 2 && newPatientsCount === "") ||
    (step === 3 && !patientEntriesValid()) ||
    (step === 4 && dollars === "");

  return (
    <>
      <button
        type="button"
        className="ck-btn-primary inline-flex items-center gap-1.5 shadow-sm"
        data-testid="button-enter-daily-stats"
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        <span aria-hidden="true" className="text-lg leading-none">
          +
        </span>
        Enter Daily Stats
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="daily-stats-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Close dialog"
            onClick={close}
          />
          <div className="relative z-10 w-full sm:max-w-md max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-border bg-surface shadow-card p-5 sm:p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3
                  id="daily-stats-title"
                  className="text-lg font-semibold tracking-tight"
                >
                  Enter Daily Stats
                </h3>
                <p className="text-sm text-ink-muted mt-0.5">
                  Record visits, new patients, and collections for {date}.
                </p>
              </div>
              <button
                type="button"
                className="ck-btn-ghost px-2 py-1 text-xs"
                onClick={close}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {step < 5 ? (
              <p className="text-xs font-medium text-ink-muted">
                Step {displayStep()} of {totalSteps()}
              </p>
            ) : null}

            {error ? (
              <p className="rounded-lg border border-border px-3 py-2 text-sm text-[color:var(--color-danger)] bg-[color:var(--color-danger-soft)]">
                {error}
              </p>
            ) : null}

            {step === 1 ? (
              <div className="space-y-3">
                <p className="text-sm font-medium">Patient visits</p>
                <label className="block text-sm">
                  <span className="block text-ink-muted mb-1">Date</span>
                  <input
                    type="date"
                    className="ck-input"
                    value={date}
                    max={localTodayYmd()}
                    onChange={(e) => setDate(e.target.value)}
                    data-testid="input-daily-date"
                  />
                </label>
                <label className="block text-sm">
                  <span className="block text-ink-muted mb-1">
                    Number of visits
                  </span>
                  <input
                    type="number"
                    min={0}
                    className="ck-input"
                    placeholder="0"
                    value={visits}
                    onChange={(e) => setVisits(e.target.value)}
                    onKeyDown={onKeyDown}
                    data-testid="input-daily-visits"
                  />
                </label>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="space-y-3">
                <p className="text-sm font-medium">New patients count</p>
                <label className="block text-sm">
                  <span className="block text-ink-muted mb-1">
                    How many new patients today?
                  </span>
                  <input
                    type="number"
                    min={0}
                    className="ck-input"
                    placeholder="0"
                    value={newPatientsCount}
                    onChange={(e) => setNewPatientsCount(e.target.value)}
                    onKeyDown={onKeyDown}
                    autoFocus
                    data-testid="input-daily-new-patients"
                  />
                </label>
                <p className="text-xs text-ink-muted">
                  Enter 0 if there were no new patients.
                </p>
              </div>
            ) : null}

            {step === 3 ? (
              <div className="space-y-3">
                <p className="text-sm font-medium">New patient details</p>
                <div className="max-h-[340px] overflow-y-auto space-y-3 pr-1">
                  {entries.map((entry, index) => (
                    <div
                      key={index}
                      className="rounded-xl border border-border bg-canvas/60 p-3 space-y-2"
                    >
                      <p className="text-sm font-semibold">
                        Patient {index + 1}
                      </p>
                      <label className="block text-sm">
                        <span className="block text-ink-muted mb-1">
                          Category
                        </span>
                        <select
                          className="ck-input"
                          value={entry.patientType}
                          onChange={(e) =>
                            updateEntry(index, {
                              patientType: e.target.value as "new" | "wellness",
                            })
                          }
                          data-testid={`select-category-${index}`}
                        >
                          <option value="new">New patient</option>
                          <option value="wellness">Wellness patient</option>
                        </select>
                      </label>

                      {entry.patientType === "new" ? (
                        <label className="block text-sm">
                          <span className="block text-ink-muted mb-1">
                            Appointment
                          </span>
                          <select
                            className="ck-input"
                            value={entry.appointmentType}
                            onChange={(e) =>
                              updateEntry(index, {
                                appointmentType: e.target
                                  .value as "day1" | "day2",
                              })
                            }
                            data-testid={`select-appointment-type-${index}`}
                          >
                            <option value="day1">Day 1 (new)</option>
                            <option value="day2">Day 2 (report of findings)</option>
                          </select>
                        </label>
                      ) : null}

                      {entry.patientType === "new" &&
                      entry.appointmentType === "day2" ? (
                        <div className="space-y-2">
                          <span className="block text-sm text-ink-muted">
                            Link Day 1 patient
                          </span>
                          {entry.priorPatientId ? (
                            <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
                              <span className="flex-1 text-sm font-medium">
                                {entry.name}
                              </span>
                              <button
                                type="button"
                                className="ck-btn-ghost text-xs"
                                onClick={() =>
                                  updateEntry(index, {
                                    priorPatientId: null,
                                    name: "",
                                  })
                                }
                              >
                                Change
                              </button>
                            </div>
                          ) : (
                            <>
                              <input
                                className="ck-input"
                                placeholder="Search Day 1 patients…"
                                value={searchQueries[index] || ""}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setSearchQueries((prev) => {
                                    const next = [...prev];
                                    next[index] = v;
                                    return next;
                                  });
                                }}
                                data-testid={`input-search-patient-${index}`}
                              />
                              <ul className="max-h-28 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                                {filteredDay1(searchQueries[index] || "").map(
                                  (p) => (
                                    <li key={p.id}>
                                      <button
                                        type="button"
                                        className="w-full text-left px-3 py-2 text-sm hover:bg-sidebar-hover"
                                        onClick={() => selectDay1(index, p)}
                                      >
                                        <span className="font-medium">
                                          {p.name}
                                        </span>
                                        <span className="block text-xs text-ink-muted">
                                          Day 1 · {p.day1Date}
                                        </span>
                                      </button>
                                    </li>
                                  ),
                                )}
                                {filteredDay1(searchQueries[index] || "")
                                  .length === 0 ? (
                                  <li className="px-3 py-2 text-xs text-ink-muted">
                                    No match — enter name manually below.
                                  </li>
                                ) : null}
                              </ul>
                              <input
                                className="ck-input"
                                placeholder="Or type name (unlinked Day 2)"
                                value={entry.name}
                                onChange={(e) =>
                                  updateEntry(index, { name: e.target.value })
                                }
                                data-testid={`input-manual-name-${index}`}
                              />
                            </>
                          )}
                          <CareAnswerSelect
                            index={index}
                            value={entry.careAnswer}
                            label="Was care started?"
                            onChange={(v) =>
                              updateEntry(index, { careAnswer: v })
                            }
                          />
                        </div>
                      ) : null}

                      {(entry.patientType === "wellness" ||
                        (entry.patientType === "new" &&
                          entry.appointmentType === "day1")) && (
                        <>
                          <label className="block text-sm">
                            <span className="block text-ink-muted mb-1">
                              Name
                            </span>
                            <input
                              className="ck-input"
                              placeholder="Patient name"
                              value={entry.name}
                              onChange={(e) =>
                                updateEntry(index, { name: e.target.value })
                              }
                              data-testid={`input-patient-name-${index}`}
                            />
                          </label>
                          <label className="block text-sm">
                            <span className="block text-ink-muted mb-1">
                              How did they find you?
                            </span>
                            <input
                              className="ck-input"
                              list={`daily-stats-referrals-${index}`}
                              placeholder="Referral source"
                              value={entry.referralSource}
                              onChange={(e) =>
                                updateEntry(index, {
                                  referralSource: e.target.value,
                                })
                              }
                              data-testid={`input-referral-${index}`}
                            />
                            <datalist id={`daily-stats-referrals-${index}`}>
                              {sources.map((s) => (
                                <option key={s.id} value={s.name} />
                              ))}
                            </datalist>
                          </label>
                          {entry.patientType === "wellness" ? (
                            <CareAnswerSelect
                              index={index}
                              value={entry.careAnswer}
                              label="Committed to continuation plan?"
                              onChange={(v) =>
                                updateEntry(index, { careAnswer: v })
                              }
                            />
                          ) : null}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {step === 4 ? (
              <div className="space-y-3">
                <p className="text-sm font-medium">Revenue collected</p>
                <label className="block text-sm">
                  <span className="block text-ink-muted mb-1">
                    Dollars collected today
                  </span>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted">
                      $
                    </span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className="ck-input pl-7"
                      placeholder="0.00"
                      value={dollars}
                      onChange={(e) => setDollars(e.target.value)}
                      onKeyDown={onKeyDown}
                      autoFocus
                      data-testid="input-daily-dollars"
                    />
                  </div>
                </label>
              </div>
            ) : null}

            {step === 5 ? (
              <div className="py-6 text-center space-y-2">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary-soft text-2xl text-primary">
                  ✓
                </div>
                <p className="text-lg font-semibold">Stats recorded</p>
                <p className="text-sm text-ink-muted">
                  Visits, patients, and collections saved.
                </p>
              </div>
            ) : null}

            {step < 5 ? (
              <div className="flex flex-wrap justify-end gap-2 pt-1">
                {step > 1 ? (
                  <button
                    type="button"
                    className="ck-btn-ghost"
                    onClick={handleBack}
                    disabled={saving}
                    data-testid="button-daily-stats-back"
                  >
                    Back
                  </button>
                ) : null}
                <button
                  type="button"
                  className="ck-btn-primary"
                  onClick={handleNext}
                  disabled={nextDisabled}
                  data-testid="button-daily-stats-next"
                >
                  {saving ? "Saving…" : step === 4 ? "Save" : "Next"}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

function CareAnswerSelect({
  index,
  value,
  label,
  onChange,
}: {
  index: number;
  value: ReplitCareAnswer | null;
  label: string;
  onChange: (v: ReplitCareAnswer) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="block text-ink-muted mb-1">{label}</span>
      <select
        className="ck-input"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value as ReplitCareAnswer)}
        data-testid={`select-care-status-${index}`}
      >
        <option value="" disabled>
          Select…
        </option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
        <option value="followup">Follow-up</option>
      </select>
    </label>
  );
}
