import { FormEvent, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import AppShell from "../components/AppShell";
import {
  api,
  type MeResponse,
  type Project,
  type ProjectColumn,
  type ProjectDetailResponse,
  type ProjectTask,
} from "../lib/api";

type Props = {
  me: MeResponse;
  projectId: string;
  onLogout: () => void;
};

type TaskDraft = {
  title: string;
  notes: string;
  dueDate: string;
  assigneeName: string;
};

const EMPTY_DRAFT: TaskDraft = {
  title: "",
  notes: "",
  dueDate: "",
  assigneeName: "",
};

export default function ProjectDetailPage({
  me,
  projectId,
  onLogout,
}: Props) {
  const canWrite = Boolean(me.active?.role && me.active.role !== "readonly");
  const canDelete = me.active?.role === "owner" || me.active?.role === "admin";
  const [, setLocation] = useLocation();
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [addColumn, setAddColumn] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<ProjectTask | null>(null);
  const [editForm, setEditForm] = useState<TaskDraft>(EMPTY_DRAFT);

  async function load() {
    const body = await api<ProjectDetailResponse>(`/api/projects/${projectId}`);
    setProject(body.project);
  }

  useEffect(() => {
    load().catch((err) =>
      setError(err instanceof Error ? err.message : "Could not load project"),
    );
  }, [projectId]);

  async function addTask(columnId: string, e: FormEvent) {
    e.preventDefault();
    if (!canWrite) return;
    const title = (drafts[columnId] ?? "").trim();
    if (!title) return;
    setError("");
    setSaving(true);
    try {
      await api(`/api/projects/${projectId}/tasks`, {
        method: "POST",
        body: JSON.stringify({ title, columnId }),
      });
      setDrafts((prev) => ({ ...prev, [columnId]: "" }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Add task failed");
    } finally {
      setSaving(false);
    }
  }

  async function toggleTask(task: ProjectTask) {
    if (!canWrite) return;
    setError("");
    try {
      await api(`/api/project-tasks/${task.id}/toggle`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Toggle failed");
    }
  }

  async function moveTask(task: ProjectTask, columnId: string) {
    if (!canWrite || columnId === task.columnId) return;
    setError("");
    try {
      await api(`/api/project-tasks/${task.id}/move`, {
        method: "POST",
        body: JSON.stringify({ columnId }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Move failed");
    }
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setError("");
    setSaving(true);
    try {
      await api(`/api/project-tasks/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: editForm.title.trim(),
          notes: editForm.notes.trim() || null,
          dueDate: editForm.dueDate || null,
          assigneeName: editForm.assigneeName.trim() || null,
        }),
      });
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function deleteTask(task: ProjectTask) {
    if (!canWrite) return;
    if (!confirm("Delete this task?")) return;
    setError("");
    try {
      await api(`/api/project-tasks/${task.id}`, { method: "DELETE" });
      if (editing?.id === task.id) setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  async function createColumn(e: FormEvent) {
    e.preventDefault();
    const name = addColumn.trim();
    if (!name) return;
    setError("");
    setSaving(true);
    try {
      await api(`/api/projects/${projectId}/columns`, {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setAddColumn("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Add column failed");
    } finally {
      setSaving(false);
    }
  }

  async function duplicate() {
    setError("");
    setSaving(true);
    try {
      const body = await api<ProjectDetailResponse>(
        `/api/projects/${projectId}/duplicate`,
        { method: "POST", body: JSON.stringify({}) },
      );
      setLocation(`/projects/${body.project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Duplicate failed");
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    if (!confirm("Archive this project?")) return;
    setError("");
    try {
      await api(`/api/projects/${projectId}/archive`, { method: "POST" });
      setLocation("/projects");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Archive failed");
    }
  }

  const columns = project?.columns ?? [];
  const isTemplate = project?.status === "template";

  return (
    <AppShell me={me} onLogout={onLogout}>
      <p className="text-sm">
        <Link href="/projects" className="text-accent-600">
          ← Projects
        </Link>
      </p>

      {!project ? (
        <p className="text-sm text-ink-500">{error || "Loading…"}</p>
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <h2 className="text-2xl font-semibold">{project.name}</h2>
              {project.description ? (
                <p className="text-sm text-ink-500">{project.description}</p>
              ) : null}
              <p className="text-sm text-ink-500">
                {project.doneCount}/{project.taskCount} tasks ·{" "}
                {project.completionPercent}% complete
              </p>
              <div className="h-2 w-48 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full bg-accent-500"
                  style={{ width: `${project.completionPercent}%` }}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {canWrite ? (
                <button
                  type="button"
                  onClick={duplicate}
                  disabled={saving}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                >
                  {isTemplate ? "Use template" : "Duplicate"}
                </button>
              ) : null}
              {canDelete && project.status === "active" ? (
                <button
                  type="button"
                  onClick={archive}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                >
                  Archive
                </button>
              ) : null}
            </div>
          </div>

          {isTemplate ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-ink-500">
              This is a template, not an active board. Duplicate it to start a
              live project.
            </div>
          ) : null}

          {error ? <p className="text-sm text-red-700">{error}</p> : null}

          {editing ? (
            <section className="bg-white shadow-card rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Edit task</h3>
                <button
                  type="button"
                  className="text-sm text-ink-500"
                  onClick={() => setEditing(null)}
                >
                  Close
                </button>
              </div>
              <p className="text-xs text-ink-500">
                Prefer operational titles. Put patient-specific detail in notes.
              </p>
              <form onSubmit={saveEdit} className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm sm:col-span-2">
                  <span className="block text-ink-500 mb-1">Title</span>
                  <input
                    required
                    className="w-full rounded-lg border border-slate-200 px-3 py-2"
                    value={editForm.title}
                    onChange={(e) =>
                      setEditForm((prev) => ({ ...prev, title: e.target.value }))
                    }
                    maxLength={200}
                  />
                </label>
                <label className="text-sm sm:col-span-2">
                  <span className="block text-ink-500 mb-1">Notes</span>
                  <textarea
                    className="w-full rounded-lg border border-slate-200 px-3 py-2"
                    rows={3}
                    value={editForm.notes}
                    onChange={(e) =>
                      setEditForm((prev) => ({ ...prev, notes: e.target.value }))
                    }
                    maxLength={2000}
                  />
                </label>
                <label className="text-sm">
                  <span className="block text-ink-500 mb-1">Due date</span>
                  <input
                    type="date"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2"
                    value={editForm.dueDate}
                    onChange={(e) =>
                      setEditForm((prev) => ({ ...prev, dueDate: e.target.value }))
                    }
                  />
                </label>
                <label className="text-sm">
                  <span className="block text-ink-500 mb-1">Assignee</span>
                  <input
                    className="w-full rounded-lg border border-slate-200 px-3 py-2"
                    value={editForm.assigneeName}
                    onChange={(e) =>
                      setEditForm((prev) => ({
                        ...prev,
                        assigneeName: e.target.value,
                      }))
                    }
                    maxLength={80}
                  />
                </label>
                <div className="sm:col-span-2 flex gap-2">
                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-lg bg-accent-500 text-white px-4 py-2 text-sm font-medium disabled:opacity-60"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteTask(editing)}
                    className="rounded-lg border border-slate-200 px-4 py-2 text-sm"
                  >
                    Delete
                  </button>
                </div>
              </form>
            </section>
          ) : null}

          {columns.length === 0 ? (
            <div className="bg-white shadow-card rounded-2xl p-8 text-center text-sm text-ink-500">
              This project has no columns yet.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              {columns.map((column) => (
                <Column
                  key={column.id}
                  column={column}
                  columns={columns}
                  canWrite={canWrite}
                  draft={drafts[column.id] ?? ""}
                  onDraft={(value) =>
                    setDrafts((prev) => ({ ...prev, [column.id]: value }))
                  }
                  onAdd={(e) => addTask(column.id, e)}
                  onToggle={toggleTask}
                  onMove={moveTask}
                  onEdit={(task) => {
                    setEditing(task);
                    setEditForm({
                      title: task.title,
                      notes: task.notes ?? "",
                      dueDate: task.dueDate ?? "",
                      assigneeName: task.assigneeName ?? "",
                    });
                  }}
                />
              ))}
            </div>
          )}

          {canWrite ? (
            <form onSubmit={createColumn} className="flex gap-2 max-w-sm">
              <input
                className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                placeholder="Add column"
                value={addColumn}
                onChange={(e) => setAddColumn(e.target.value)}
                maxLength={80}
              />
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                Add
              </button>
            </form>
          ) : null}
        </>
      )}
    </AppShell>
  );
}

function Column({
  column,
  columns,
  canWrite,
  draft,
  onDraft,
  onAdd,
  onToggle,
  onMove,
  onEdit,
}: {
  column: ProjectColumn;
  columns: ProjectColumn[];
  canWrite: boolean;
  draft: string;
  onDraft: (value: string) => void;
  onAdd: (e: FormEvent) => void;
  onToggle: (task: ProjectTask) => void;
  onMove: (task: ProjectTask, columnId: string) => void;
  onEdit: (task: ProjectTask) => void;
}) {
  const tasks = column.tasks ?? [];
  return (
    <section className="bg-white shadow-card rounded-2xl p-4 space-y-3 min-h-[12rem]">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-semibold">{column.name}</h3>
        <span className="text-xs text-ink-500">{tasks.length}</span>
      </div>
      <ul className="space-y-2">
        {tasks.map((task) => (
          <li
            key={task.id}
            className="rounded-xl border border-slate-200 px-3 py-2 space-y-1"
          >
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={task.done}
                disabled={!canWrite}
                onChange={() => onToggle(task)}
                className="mt-0.5"
              />
              <button
                type="button"
                className={`text-left ${task.done ? "line-through text-ink-500" : ""}`}
                onClick={() => onEdit(task)}
              >
                {task.title}
              </button>
            </label>
            {task.dueDate || task.assigneeName ? (
              <p className="text-xs text-ink-500 pl-6">
                {[task.dueDate, task.assigneeName].filter(Boolean).join(" · ")}
              </p>
            ) : null}
            {canWrite && columns.length > 1 ? (
              <select
                className="ml-6 text-xs rounded border border-slate-200 px-1 py-0.5"
                value={task.columnId}
                onChange={(e) => onMove(task, e.target.value)}
              >
                {columns.map((col) => (
                  <option key={col.id} value={col.id}>
                    {col.name}
                  </option>
                ))}
              </select>
            ) : null}
          </li>
        ))}
      </ul>
      {canWrite ? (
        <form onSubmit={onAdd} className="space-y-2">
          <input
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="Add a task — skip patient names"
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            maxLength={200}
          />
        </form>
      ) : null}
    </section>
  );
}
