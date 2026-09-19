import { FormEvent, useEffect, useState } from "react";
import { Link } from "wouter";
import AppShell from "../components/AppShell";
import {
  api,
  type MeResponse,
  type Project,
  type ProjectDetailResponse,
  type ProjectsListResponse,
} from "../lib/api";

type Props = { me: MeResponse; onLogout: () => void };

type FormState = {
  name: string;
  description: string;
  tags: string;
  asTemplate: boolean;
};

const EMPTY_FORM: FormState = {
  name: "",
  description: "",
  tags: "",
  asTemplate: false,
};

function ProgressBar({ percent }: { percent: number }) {
  const width = Math.max(0, Math.min(100, percent));
  return (
    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
      <div
        className="h-full rounded-full bg-accent-500"
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

export default function ProjectsPage({ me, onLogout }: Props) {
  const canWrite = Boolean(me.active?.role && me.active.role !== "readonly");
  const canDelete = me.active?.role === "owner" || me.active?.role === "admin";
  const [data, setData] = useState<ProjectsListResponse | null>(null);
  const [archived, setArchived] = useState<Project[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    const body = await api<ProjectsListResponse>("/api/projects");
    setData(body);
  }

  async function loadArchived() {
    const body = await api<ProjectsListResponse>("/api/projects?status=archived");
    setArchived(body.projects);
  }

  useEffect(() => {
    load().catch((err) =>
      setError(err instanceof Error ? err.message : "Could not load projects"),
    );
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await api<ProjectDetailResponse>("/api/projects", {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim() || null,
          tags: form.tags,
          status: form.asTemplate ? "template" : "active",
        }),
      });
      setForm(EMPTY_FORM);
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setSaving(false);
    }
  }

  async function useTemplate(id: string) {
    setError("");
    setSaving(true);
    try {
      await api<ProjectDetailResponse>(`/api/projects/${id}/duplicate`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Duplicate failed");
    } finally {
      setSaving(false);
    }
  }

  async function archiveProject(id: string) {
    if (!confirm("Archive this project?")) return;
    setError("");
    try {
      await api(`/api/projects/${id}/archive`, { method: "POST" });
      await load();
      if (showArchived) await loadArchived();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Archive failed");
    }
  }

  const projects = data?.projects ?? [];
  const templates = data?.templates ?? [];
  const empty = data?.emptyState === "no_projects";

  return (
    <AppShell me={me} onLogout={onLogout}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Projects</h2>
          <p className="text-sm text-ink-500">
            Clinic work boards. Keep patient names out of task titles — use notes
            for details.
          </p>
        </div>
        {canWrite ? (
          <button
            type="button"
            onClick={() => setShowForm((open) => !open)}
            className="rounded-lg bg-accent-500 text-white px-4 py-2 text-sm font-medium hover:bg-accent-600"
          >
            {showForm ? "Close" : "New Project"}
          </button>
        ) : null}
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      {showForm && canWrite ? (
        <section className="bg-white shadow-card rounded-2xl p-6 space-y-4">
          <h3 className="font-semibold">New project</h3>
          <form onSubmit={onCreate} className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm sm:col-span-2">
              <span className="block text-ink-500 mb-1">Name</span>
              <input
                required
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                value={form.name}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, name: e.target.value }))
                }
                maxLength={200}
                placeholder="e.g. Front-desk refresh"
              />
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="block text-ink-500 mb-1">Description</span>
              <textarea
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                rows={2}
                value={form.description}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, description: e.target.value }))
                }
                maxLength={2000}
              />
            </label>
            <label className="text-sm">
              <span className="block text-ink-500 mb-1">Tags (comma-separated)</span>
              <input
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                value={form.tags}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, tags: e.target.value }))
                }
                placeholder="ops, marketing"
              />
            </label>
            <label className="text-sm flex items-center gap-2 mt-6">
              <input
                type="checkbox"
                checked={form.asTemplate}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, asTemplate: e.target.checked }))
                }
              />
              Save as template
            </label>
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-accent-500 text-white px-4 py-2 text-sm font-medium disabled:opacity-60"
              >
                {saving ? "Saving…" : form.asTemplate ? "Save template" : "Create project"}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="space-y-3">
        <h3 className="font-semibold">Active</h3>
        {empty ? (
          <div className="bg-white shadow-card rounded-2xl p-8 text-center text-sm text-ink-500">
            No active projects yet.
            {canWrite ? " Create one, or duplicate a template below." : ""}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {projects.map((project) => (
              <article
                key={project.id}
                className="bg-white shadow-card rounded-2xl p-5 space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Link
                      href={`/projects/${project.id}`}
                      className="font-semibold text-clinical-700 hover:underline"
                    >
                      {project.name}
                    </Link>
                    {project.description ? (
                      <p className="text-sm text-ink-500 mt-1 line-clamp-2">
                        {project.description}
                      </p>
                    ) : null}
                  </div>
                  <span className="text-sm tabular-nums text-ink-500">
                    {project.completionPercent}%
                  </span>
                </div>
                <ProgressBar percent={project.completionPercent} />
                <p className="text-sm text-ink-500">
                  {project.doneCount}/{project.taskCount} tasks done
                </p>
                {project.tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {project.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-clinical-100 text-clinical-700 px-2 py-0.5 text-xs"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
                {canDelete ? (
                  <button
                    type="button"
                    onClick={() => archiveProject(project.id)}
                    className="text-sm text-ink-500 hover:text-ink-700"
                  >
                    Archive
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="font-semibold">Templates</h3>
        {templates.length === 0 ? (
          <p className="text-sm text-ink-500">
            No templates. Templates stay here so they are not mixed with live work.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {templates.map((template) => (
              <article
                key={template.id}
                className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 space-y-2"
              >
                <Link
                  href={`/projects/${template.id}`}
                  className="font-semibold text-clinical-700 hover:underline"
                >
                  {template.name}
                </Link>
                <p className="text-sm text-ink-500">
                  {template.taskCount} task{template.taskCount === 1 ? "" : "s"} ·
                  template
                </p>
                {canWrite ? (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => useTemplate(template.id)}
                    className="text-sm font-medium text-accent-600"
                  >
                    Use template
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>

      {(data?.archivedCount ?? 0) > 0 && canDelete ? (
        <section className="space-y-3">
          <button
            type="button"
            className="text-sm text-ink-500"
            onClick={() => {
              const next = !showArchived;
              setShowArchived(next);
              if (next) {
                loadArchived().catch((err) =>
                  setError(
                    err instanceof Error ? err.message : "Could not load archived",
                  ),
                );
              }
            }}
          >
            {showArchived ? "Hide archived" : `Show archived (${data?.archivedCount})`}
          </button>
          {showArchived ? (
            <ul className="space-y-2 text-sm">
              {archived.map((row) => (
                <li key={row.id}>
                  <Link href={`/projects/${row.id}`} className="text-clinical-700">
                    {row.name}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </AppShell>
  );
}
