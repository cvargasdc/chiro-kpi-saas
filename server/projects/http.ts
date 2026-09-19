import type { Express, Request, Response } from "express";
import { z } from "zod";
import { DATE_RE, isValidYmd } from "@shared/kpis";
import {
  DEFAULT_PROJECT_COLUMNS,
  MAX_ASSIGNEE_NAME,
  MAX_COLUMN_NAME,
  MAX_COLUMNS_PER_PROJECT,
  MAX_PROJECT_DESCRIPTION,
  MAX_PROJECT_NAME,
  MAX_TASK_NOTES,
  MAX_TASK_TITLE,
  PROJECT_STATUSES,
  defaultDuplicateName,
  isProjectStatus,
  normalizeTags,
} from "@shared/projects";
import {
  PHI_DELETE_ROLES,
  PHI_READ_ROLES,
  PHI_WRITE_ROLES,
} from "@shared/roles";
import { logAudit } from "../audit/logAudit";
import {
  authenticate,
  getClientIp,
  requirePracticeMembership,
  requireRole,
} from "../auth/middleware";
import { requireActiveSubscription } from "../billing/entitlement";
import type { HttpContext } from "../http-context";
import type {
  StoredProject,
  StoredProjectColumn,
  StoredProjectTask,
} from "../storage/types";
import {
  FEATURE_NOTE,
  ghlWebhookNotImplemented,
  publicProject,
  publicProjectColumn,
  publicProjectTask,
  taskCounts,
  type PublicProjectColumnWithTasks,
} from "./public";

const dateSchema = z
  .string()
  .regex(DATE_RE)
  .refine(isValidYmd, { message: "invalid_date" });

const tagsSchema = z.union([z.array(z.string()), z.string()]).optional();

const projectCreateSchema = z.object({
  name: z.string().min(1).max(MAX_PROJECT_NAME),
  description: z
    .union([z.string().max(MAX_PROJECT_DESCRIPTION), z.null()])
    .optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  tags: tagsSchema,
  columns: z
    .array(
      z.object({
        name: z.string().min(1).max(MAX_COLUMN_NAME),
        sortOrder: z.number().int().min(0).max(10_000).optional(),
      }),
    )
    .max(MAX_COLUMNS_PER_PROJECT)
    .optional(),
});

const projectPatchSchema = z.object({
  name: z.string().min(1).max(MAX_PROJECT_NAME).optional(),
  description: z
    .union([z.string().max(MAX_PROJECT_DESCRIPTION), z.null()])
    .optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  tags: tagsSchema,
});

const duplicateSchema = z.object({
  name: z.string().min(1).max(MAX_PROJECT_NAME).optional(),
});

const columnCreateSchema = z.object({
  name: z.string().min(1).max(MAX_COLUMN_NAME),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});

const columnPatchSchema = z.object({
  name: z.string().min(1).max(MAX_COLUMN_NAME).optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});

const taskCreateSchema = z.object({
  title: z.string().min(1).max(MAX_TASK_TITLE),
  columnId: z.string().min(1).optional(),
  notes: z.union([z.string().max(MAX_TASK_NOTES), z.null()]).optional(),
  description: z.union([z.string().max(MAX_TASK_NOTES), z.null()]).optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  done: z.boolean().optional(),
  dueDate: z.union([dateSchema, z.null()]).optional(),
  assigneeName: z
    .union([z.string().max(MAX_ASSIGNEE_NAME), z.null()])
    .optional(),
});

const taskPatchSchema = z.object({
  title: z.string().min(1).max(MAX_TASK_TITLE).optional(),
  columnId: z.string().min(1).optional(),
  notes: z.union([z.string().max(MAX_TASK_NOTES), z.null()]).optional(),
  description: z.union([z.string().max(MAX_TASK_NOTES), z.null()]).optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  done: z.boolean().optional(),
  dueDate: z.union([dateSchema, z.null()]).optional(),
  assigneeName: z
    .union([z.string().max(MAX_ASSIGNEE_NAME), z.null()])
    .optional(),
});

const taskMoveSchema = z.object({
  columnId: z.string().min(1),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});

const taskToggleSchema = z.object({
  done: z.boolean().optional(),
});

function trimOrNull(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveNotes(input: {
  notes?: string | null;
  description?: string | null;
}): string | null | undefined {
  if (input.notes !== undefined) return trimOrNull(input.notes);
  if (input.description !== undefined) return trimOrNull(input.description);
  return undefined;
}

async function loadBoard(
  storage: HttpContext["storage"],
  scope: { orgId: string; practiceId: string },
  project: StoredProject,
): Promise<{
  columns: StoredProjectColumn[];
  tasks: StoredProjectTask[];
  board: PublicProjectColumnWithTasks[];
  counts: { done: number; total: number };
}> {
  const [columns, tasks] = await Promise.all([
    storage.listProjectColumns(scope, project.id),
    storage.listProjectTasks(scope, project.id),
  ]);
  const counts = taskCounts(tasks);
  const board = columns.map((column) => {
    const columnTasks = tasks.filter((task) => task.columnId === column.id);
    const columnCounts = taskCounts(columnTasks);
    return {
      ...publicProjectColumn(column),
      tasks: columnTasks.map(publicProjectTask),
      taskCount: columnCounts.total,
      doneCount: columnCounts.done,
    };
  });
  return { columns, tasks, board, counts };
}

function projectPayload(
  project: StoredProject,
  board: PublicProjectColumnWithTasks[],
  counts: { done: number; total: number },
) {
  return {
    ...publicProject(project, counts),
    columns: board,
  };
}

export function registerProjectRoutes(app: Express, ctx: HttpContext): void {
  const storage = ctx.storage;
  const auth = authenticate(storage);
  const practiceGate = requirePracticeMembership(storage);
  const billingGate = requireActiveSubscription(ctx);

  function ghlStub(_req: Request, res: Response) {
    const stub = ghlWebhookNotImplemented();
    return res.status(stub.status).json(stub.body);
  }
  app.get("/api/ghl/webhook", auth, practiceGate, ghlStub);
  app.post("/api/ghl/webhook", auth, practiceGate, ghlStub);
  app.post("/api/projects/ghl-webhook", auth, practiceGate, ghlStub);

  app.get(
    "/api/projects",
    auth,
    practiceGate,
    requireRole(...PHI_READ_ROLES),
    async (req, res) => {
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const rawStatus =
        typeof req.query.status === "string" ? req.query.status : "";
      if (rawStatus && !isProjectStatus(rawStatus)) {
        return res.status(400).json({ error: "invalid_status" });
      }
      const includeArchived =
        req.query.includeArchived === "true" ||
        req.query.includeArchived === "1";
      const [allProjects, allTasks] = await Promise.all([
        storage.listProjects(scope),
        storage.listProjectTasks(scope),
      ]);
      const countsByProject = new Map<string, { done: number; total: number }>();
      for (const task of allTasks) {
        const current = countsByProject.get(task.projectId) ?? {
          done: 0,
          total: 0,
        };
        current.total += 1;
        if (task.done) current.done += 1;
        countsByProject.set(task.projectId, current);
      }
      const withCounts = (row: StoredProject) =>
        publicProject(row, countsByProject.get(row.id) ?? { done: 0, total: 0 });

      const templates = allProjects
        .filter((row) => row.status === "template")
        .map(withCounts);
      const archived = allProjects.filter((row) => row.status === "archived");
      let listed = allProjects.filter((row) => row.status === "active");
      if (rawStatus === "archived") {
        listed = archived;
      } else if (rawStatus === "template") {
        listed = allProjects.filter((row) => row.status === "template");
      } else if (rawStatus === "active") {
        listed = allProjects.filter((row) => row.status === "active");
      } else if (includeArchived) {
        listed = allProjects.filter((row) => row.status !== "template");
      }

      const emptyState =
        allProjects.filter((row) => row.status === "active").length === 0
          ? "no_projects"
          : "has_data";

      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "list",
        resourceType: "project",
        metadata: {
          count: listed.length,
          templateCount: templates.length,
          archivedCount: archived.length,
          status: rawStatus || null,
        },
        ipAddress: getClientIp(req),
      });

      res.json({
        emptyState,
        projects: listed.map(withCounts),
        templates: rawStatus && rawStatus !== "template" ? [] : templates,
        archivedCount: archived.length,
        feature: FEATURE_NOTE,
      });
    },
  );

  app.post(
    "/api/projects",
    auth,
    practiceGate,
    requireRole(...PHI_WRITE_ROLES),
    billingGate,
    async (req, res) => {
      const parsed = projectCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "invalid_input", details: parsed.error.flatten() });
      }
      const name = parsed.data.name.trim();
      if (!name) {
        return res.status(400).json({ error: "name_required" });
      }
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const status = parsed.data.status ?? "active";
      const project = await storage.createProject(scope, {
        name,
        description: trimOrNull(parsed.data.description ?? null) ?? null,
        status,
        tags: normalizeTags(parsed.data.tags),
        createdBy: req.currentUser!.id,
      });
      const columnSpecs =
        parsed.data.columns && parsed.data.columns.length > 0
          ? parsed.data.columns.map((col, index) => ({
              name: col.name.trim(),
              sortOrder: col.sortOrder ?? index,
            }))
          : DEFAULT_PROJECT_COLUMNS.map((col) => ({
              name: col.name,
              sortOrder: col.sortOrder,
            }));
      for (const spec of columnSpecs) {
        if (!spec.name) continue;
        await storage.createProjectColumn(scope, {
          projectId: project.id,
          name: spec.name,
          sortOrder: spec.sortOrder,
        });
      }
      const loaded = await loadBoard(storage, scope, project);
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "create",
        resourceType: "project",
        resourceId: project.id,
        metadata: {
          status,
          columnCount: loaded.columns.length,
          tagCount: project.tags.length,
          fields: ["name", "description", "status", "tags"],
        },
        ipAddress: getClientIp(req),
      });
      res.status(201).json({
        project: projectPayload(project, loaded.board, loaded.counts),
        feature: FEATURE_NOTE,
      });
    },
  );

  app.post(
    "/api/projects/:id/duplicate",
    auth,
    practiceGate,
    requireRole(...PHI_WRITE_ROLES),
    billingGate,
    async (req, res) => {
      const parsed = duplicateSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "invalid_input", details: parsed.error.flatten() });
      }
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const source = await storage.getProject(scope, req.params.id);
      if (!source) {
        return res.status(404).json({ error: "not_found" });
      }
      const sourceBoard = await loadBoard(storage, scope, source);
      const name =
        parsed.data.name?.trim() ||
        defaultDuplicateName(
          source.name,
          isProjectStatus(source.status) ? source.status : "active",
        );
      const copy = await storage.createProject(scope, {
        name,
        description: source.description,
        status: "active",
        tags: [...source.tags],
        createdBy: req.currentUser!.id,
      });
      const columnIdMap = new Map<string, string>();
      for (const column of sourceBoard.columns) {
        const created = await storage.createProjectColumn(scope, {
          projectId: copy.id,
          name: column.name,
          sortOrder: column.sortOrder,
        });
        columnIdMap.set(column.id, created.id);
      }
      let copiedTasks = 0;
      for (const task of sourceBoard.tasks) {
        const nextColumnId = columnIdMap.get(task.columnId);
        if (!nextColumnId) continue;
        await storage.createProjectTask(scope, {
          projectId: copy.id,
          columnId: nextColumnId,
          title: task.title,
          notes: task.notes,
          sortOrder: task.sortOrder,
          done: task.done,
          dueDate: task.dueDate,
          assigneeName: task.assigneeName,
        });
        copiedTasks += 1;
      }
      const loaded = await loadBoard(storage, scope, copy);
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "create",
        resourceType: "project",
        resourceId: copy.id,
        metadata: {
          duplicatedFrom: source.id,
          sourceStatus: source.status,
          columnCount: loaded.columns.length,
          taskCount: copiedTasks,
        },
        ipAddress: getClientIp(req),
      });
      res.status(201).json({
        project: projectPayload(copy, loaded.board, loaded.counts),
        duplicatedFrom: source.id,
        feature: FEATURE_NOTE,
      });
    },
  );

  app.post(
    "/api/projects/:id/archive",
    auth,
    practiceGate,
    requireRole(...PHI_DELETE_ROLES),
    billingGate,
    async (req, res) => {
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const existing = await storage.getProject(scope, req.params.id);
      if (!existing) {
        return res.status(404).json({ error: "not_found" });
      }
      const updated = await storage.updateProject(scope, existing.id, {
        status: "archived",
      });
      const loaded = await loadBoard(storage, scope, updated ?? existing);
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "update",
        resourceType: "project",
        resourceId: existing.id,
        metadata: { fields: ["status"], status: "archived" },
        ipAddress: getClientIp(req),
      });
      res.json({
        project: projectPayload(updated ?? existing, loaded.board, loaded.counts),
      });
    },
  );

  app.post(
    "/api/projects/:id/columns",
    auth,
    practiceGate,
    requireRole(...PHI_WRITE_ROLES),
    billingGate,
    async (req, res) => {
      const parsed = columnCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "invalid_input", details: parsed.error.flatten() });
      }
      const name = parsed.data.name.trim();
      if (!name) {
        return res.status(400).json({ error: "name_required" });
      }
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const project = await storage.getProject(scope, req.params.id);
      if (!project) {
        return res.status(404).json({ error: "not_found" });
      }
      const existing = await storage.listProjectColumns(scope, project.id);
      if (existing.length >= MAX_COLUMNS_PER_PROJECT) {
        return res.status(400).json({ error: "too_many_columns" });
      }
      const column = await storage.createProjectColumn(scope, {
        projectId: project.id,
        name,
        sortOrder: parsed.data.sortOrder ?? existing.length,
      });
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "create",
        resourceType: "project_column",
        resourceId: column.id,
        metadata: { projectId: project.id, sortOrder: column.sortOrder },
        ipAddress: getClientIp(req),
      });
      res.status(201).json({ column: publicProjectColumn(column) });
    },
  );

  app.post(
    "/api/projects/:id/tasks",
    auth,
    practiceGate,
    requireRole(...PHI_WRITE_ROLES),
    billingGate,
    async (req, res) => {
      const parsed = taskCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "invalid_input", details: parsed.error.flatten() });
      }
      const title = parsed.data.title.trim();
      if (!title) {
        return res.status(400).json({ error: "title_required" });
      }
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const project = await storage.getProject(scope, req.params.id);
      if (!project) {
        return res.status(404).json({ error: "not_found" });
      }
      const columns = await storage.listProjectColumns(scope, project.id);
      if (columns.length === 0) {
        return res.status(400).json({ error: "no_columns" });
      }
      const columnId = parsed.data.columnId ?? columns[0].id;
      const column = columns.find((item) => item.id === columnId);
      if (!column) {
        return res.status(400).json({ error: "invalid_column" });
      }
      const existingTasks = await storage.listProjectTasks(scope, project.id);
      const inColumn = existingTasks.filter((task) => task.columnId === column.id);
      const task = await storage.createProjectTask(scope, {
        projectId: project.id,
        columnId: column.id,
        title,
        notes: resolveNotes(parsed.data) ?? null,
        sortOrder: parsed.data.sortOrder ?? inColumn.length,
        done: parsed.data.done ?? false,
        dueDate: parsed.data.dueDate === undefined ? null : parsed.data.dueDate,
        assigneeName: trimOrNull(parsed.data.assigneeName ?? null) ?? null,
      });
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "create",
        resourceType: "project_task",
        resourceId: task.id,
        metadata: {
          projectId: project.id,
          columnId: column.id,
          fields: ["title", "notes", "dueDate", "assigneeName", "done"],
        },
        ipAddress: getClientIp(req),
      });
      res.status(201).json({ task: publicProjectTask(task) });
    },
  );

  app.get(
    "/api/projects/:id",
    auth,
    practiceGate,
    requireRole(...PHI_READ_ROLES),
    async (req, res) => {
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const project = await storage.getProject(scope, req.params.id);
      if (!project) {
        return res.status(404).json({ error: "not_found" });
      }
      const loaded = await loadBoard(storage, scope, project);
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "read",
        resourceType: "project",
        resourceId: project.id,
        metadata: {
          status: project.status,
          columnCount: loaded.columns.length,
          taskCount: loaded.counts.total,
          doneCount: loaded.counts.done,
        },
        ipAddress: getClientIp(req),
      });
      res.json({
        project: projectPayload(project, loaded.board, loaded.counts),
        feature: FEATURE_NOTE,
      });
    },
  );

  app.patch(
    "/api/projects/:id",
    auth,
    practiceGate,
    requireRole(...PHI_WRITE_ROLES),
    billingGate,
    async (req, res) => {
      const parsed = projectPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "invalid_input", details: parsed.error.flatten() });
      }
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const existing = await storage.getProject(scope, req.params.id);
      if (!existing) {
        return res.status(404).json({ error: "not_found" });
      }
      if (parsed.data.status !== undefined) {
        const role = req.tenant!.role;
        if (!PHI_DELETE_ROLES.includes(role)) {
          return res.status(403).json({ error: "insufficient_role" });
        }
      }
      const name = parsed.data.name?.trim();
      if (parsed.data.name !== undefined && !name) {
        return res.status(400).json({ error: "name_required" });
      }
      const updated = await storage.updateProject(scope, existing.id, {
        name,
        description:
          parsed.data.description === undefined
            ? undefined
            : (trimOrNull(parsed.data.description) ?? null),
        status: parsed.data.status,
        tags:
          parsed.data.tags === undefined
            ? undefined
            : normalizeTags(parsed.data.tags),
      });
      const loaded = await loadBoard(storage, scope, updated ?? existing);
      const fields = Object.keys(parsed.data);
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "update",
        resourceType: "project",
        resourceId: existing.id,
        metadata: {
          fields,
          status: (updated ?? existing).status,
        },
        ipAddress: getClientIp(req),
      });
      res.json({
        project: projectPayload(updated ?? existing, loaded.board, loaded.counts),
      });
    },
  );

  app.delete(
    "/api/projects/:id",
    auth,
    practiceGate,
    requireRole(...PHI_DELETE_ROLES),
    billingGate,
    async (req, res) => {
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const existing = await storage.getProject(scope, req.params.id);
      if (!existing) {
        return res.status(404).json({ error: "not_found" });
      }
      await storage.deleteProject(scope, existing.id);
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "delete",
        resourceType: "project",
        resourceId: existing.id,
        metadata: { status: existing.status },
        ipAddress: getClientIp(req),
      });
      res.json({ ok: true, id: existing.id });
    },
  );

  app.patch(
    "/api/project-columns/:id",
    auth,
    practiceGate,
    requireRole(...PHI_WRITE_ROLES),
    billingGate,
    async (req, res) => {
      const parsed = columnPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "invalid_input", details: parsed.error.flatten() });
      }
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const existing = await storage.getProjectColumn(scope, req.params.id);
      if (!existing) {
        return res.status(404).json({ error: "not_found" });
      }
      const name = parsed.data.name?.trim();
      if (parsed.data.name !== undefined && !name) {
        return res.status(400).json({ error: "name_required" });
      }
      const updated = await storage.updateProjectColumn(scope, existing.id, {
        name,
        sortOrder: parsed.data.sortOrder,
      });
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "update",
        resourceType: "project_column",
        resourceId: existing.id,
        metadata: {
          projectId: existing.projectId,
          fields: Object.keys(parsed.data),
        },
        ipAddress: getClientIp(req),
      });
      res.json({ column: publicProjectColumn(updated ?? existing) });
    },
  );

  app.delete(
    "/api/project-columns/:id",
    auth,
    practiceGate,
    requireRole(...PHI_DELETE_ROLES),
    billingGate,
    async (req, res) => {
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const existing = await storage.getProjectColumn(scope, req.params.id);
      if (!existing) {
        return res.status(404).json({ error: "not_found" });
      }
      const remaining = await storage.listProjectColumns(
        scope,
        existing.projectId,
      );
      if (remaining.length <= 1) {
        return res.status(409).json({ error: "last_column" });
      }
      const inUse = await storage.countProjectTasksInColumn(scope, existing.id);
      if (inUse > 0) {
        return res.status(409).json({ error: "column_in_use", taskCount: inUse });
      }
      await storage.deleteProjectColumn(scope, existing.id);
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "delete",
        resourceType: "project_column",
        resourceId: existing.id,
        metadata: { projectId: existing.projectId },
        ipAddress: getClientIp(req),
      });
      res.json({ ok: true, id: existing.id });
    },
  );

  app.post(
    "/api/project-tasks/:id/move",
    auth,
    practiceGate,
    requireRole(...PHI_WRITE_ROLES),
    billingGate,
    async (req, res) => {
      const parsed = taskMoveSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "invalid_input", details: parsed.error.flatten() });
      }
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const existing = await storage.getProjectTask(scope, req.params.id);
      if (!existing) {
        return res.status(404).json({ error: "not_found" });
      }
      const column = await storage.getProjectColumn(scope, parsed.data.columnId);
      if (!column || column.projectId !== existing.projectId) {
        return res.status(400).json({ error: "invalid_column" });
      }
      const updated = await storage.updateProjectTask(scope, existing.id, {
        columnId: column.id,
        sortOrder: parsed.data.sortOrder,
      });
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "update",
        resourceType: "project_task",
        resourceId: existing.id,
        metadata: {
          projectId: existing.projectId,
          fields: ["columnId", "sortOrder"],
          fromColumnId: existing.columnId,
          toColumnId: column.id,
        },
        ipAddress: getClientIp(req),
      });
      res.json({ task: publicProjectTask(updated ?? existing) });
    },
  );

  app.post(
    "/api/project-tasks/:id/toggle",
    auth,
    practiceGate,
    requireRole(...PHI_WRITE_ROLES),
    billingGate,
    async (req, res) => {
      const parsed = taskToggleSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "invalid_input", details: parsed.error.flatten() });
      }
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const existing = await storage.getProjectTask(scope, req.params.id);
      if (!existing) {
        return res.status(404).json({ error: "not_found" });
      }
      const done = parsed.data.done ?? !existing.done;
      const updated = await storage.updateProjectTask(scope, existing.id, {
        done,
      });
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "update",
        resourceType: "project_task",
        resourceId: existing.id,
        metadata: {
          projectId: existing.projectId,
          fields: ["done"],
          done,
        },
        ipAddress: getClientIp(req),
      });
      res.json({ task: publicProjectTask(updated ?? existing) });
    },
  );

  app.patch(
    "/api/project-tasks/:id",
    auth,
    practiceGate,
    requireRole(...PHI_WRITE_ROLES),
    billingGate,
    async (req, res) => {
      const parsed = taskPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "invalid_input", details: parsed.error.flatten() });
      }
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const existing = await storage.getProjectTask(scope, req.params.id);
      if (!existing) {
        return res.status(404).json({ error: "not_found" });
      }
      if (parsed.data.columnId) {
        const column = await storage.getProjectColumn(
          scope,
          parsed.data.columnId,
        );
        if (!column || column.projectId !== existing.projectId) {
          return res.status(400).json({ error: "invalid_column" });
        }
      }
      const title = parsed.data.title?.trim();
      if (parsed.data.title !== undefined && !title) {
        return res.status(400).json({ error: "title_required" });
      }
      const notes = resolveNotes(parsed.data);
      const updated = await storage.updateProjectTask(scope, existing.id, {
        title,
        columnId: parsed.data.columnId,
        notes,
        sortOrder: parsed.data.sortOrder,
        done: parsed.data.done,
        dueDate: parsed.data.dueDate,
        assigneeName:
          parsed.data.assigneeName === undefined
            ? undefined
            : (trimOrNull(parsed.data.assigneeName) ?? null),
      });
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "update",
        resourceType: "project_task",
        resourceId: existing.id,
        metadata: {
          projectId: existing.projectId,
          fields: Object.keys(parsed.data).map((field) =>
            field === "description" ? "notes" : field,
          ),
        },
        ipAddress: getClientIp(req),
      });
      res.json({ task: publicProjectTask(updated ?? existing) });
    },
  );

  app.delete(
    "/api/project-tasks/:id",
    auth,
    practiceGate,
    requireRole(...PHI_WRITE_ROLES),
    billingGate,
    async (req, res) => {
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const existing = await storage.getProjectTask(scope, req.params.id);
      if (!existing) {
        return res.status(404).json({ error: "not_found" });
      }
      await storage.deleteProjectTask(scope, existing.id);
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "delete",
        resourceType: "project_task",
        resourceId: existing.id,
        metadata: { projectId: existing.projectId },
        ipAddress: getClientIp(req),
      });
      res.json({ ok: true, id: existing.id });
    },
  );
}
