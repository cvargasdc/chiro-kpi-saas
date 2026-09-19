import type { Express } from "express";
import { z } from "zod";
import {
  MAX_ASSIGNEE_NAME,
  MAX_TASK_DESCRIPTION,
  MAX_TASK_NOTES,
  MAX_TASK_TITLE,
  MAX_TEMPLATE_NAME,
  ONBOARDING_PATIENT_TYPES,
  deriveChecklistStatus,
  summarizeOnboardingProgress,
} from "@shared/onboarding";
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
import type { AppStorage } from "../storage/types";
import {
  FEATURE_NOTE,
  publicChecklistTemplate,
  publicPatientChecklist,
  publicTemplateTask,
} from "./public";

const nullableString = (max: number) =>
  z.union([z.string().max(max), z.null()]);

const templateCreateSchema = z.object({
  name: z.string().min(1).max(MAX_TEMPLATE_NAME),
  patientType: z.enum(ONBOARDING_PATIENT_TYPES).optional(),
  active: z.boolean().optional(),
  tasks: z
    .array(
      z.object({
        title: z.string().min(1).max(MAX_TASK_TITLE),
        description: nullableString(MAX_TASK_DESCRIPTION).optional(),
        sortOrder: z.number().int().min(0).max(10_000).optional(),
      }),
    )
    .max(100)
    .optional(),
});

const templatePatchSchema = z.object({
  name: z.string().min(1).max(MAX_TEMPLATE_NAME).optional(),
  patientType: z.enum(ONBOARDING_PATIENT_TYPES).optional(),
  active: z.boolean().optional(),
});

const templateTaskCreateSchema = z.object({
  title: z.string().min(1).max(MAX_TASK_TITLE),
  description: nullableString(MAX_TASK_DESCRIPTION).optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});

const templateTaskPatchSchema = z.object({
  title: z.string().min(1).max(MAX_TASK_TITLE).optional(),
  description: nullableString(MAX_TASK_DESCRIPTION).optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});

const assignSchema = z.object({
  patientId: z.string().min(1),
  templateId: z.string().min(1),
  notes: nullableString(MAX_TASK_NOTES).optional(),
});

const patientChecklistPatchSchema = z.object({
  notes: nullableString(MAX_TASK_NOTES).optional(),
  status: z.enum(["not_started", "in_progress", "complete"]).optional(),
});

const taskToggleSchema = z.object({
  done: z.boolean().optional(),
  assigneeName: nullableString(MAX_ASSIGNEE_NAME).optional(),
  notes: nullableString(MAX_TASK_NOTES).optional(),
});

async function loadTemplateWithTasks(
  storage: AppStorage,
  scope: { orgId: string; practiceId: string },
  templateId: string,
) {
  const template = await storage.getChecklistTemplate(scope, templateId);
  if (!template) return null;
  const tasks = await storage.listChecklistTemplateTasks(scope, template.id);
  return { template, tasks };
}

async function loadPatientChecklistWithTasks(
  storage: AppStorage,
  scope: { orgId: string; practiceId: string },
  id: string,
) {
  const row = await storage.getPatientChecklist(scope, id);
  if (!row) return null;
  const tasks = await storage.listPatientChecklistTasks(scope, row.id);
  return { row, tasks };
}

async function syncPatientChecklistStatus(
  storage: AppStorage,
  scope: { orgId: string; practiceId: string },
  checklistId: string,
) {
  const tasks = await storage.listPatientChecklistTasks(scope, checklistId);
  const status = deriveChecklistStatus(tasks);
  return storage.updatePatientChecklist(scope, checklistId, { status });
}

export function registerOnboardingRoutes(app: Express, ctx: HttpContext): void {
  const storage = ctx.storage;
  const auth = authenticate(storage);
  const practiceGate = requirePracticeMembership(storage);
  const billingGate = requireActiveSubscription(ctx);

  app.get(
    "/api/onboarding/progress",
    auth,
    practiceGate,
    requireRole(...PHI_READ_ROLES),
    async (req, res) => {
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const rows = await storage.listPatientChecklists(scope);
      const progress = summarizeOnboardingProgress(rows);
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "list",
        resourceType: "patient_checklist",
        metadata: {
          view: "progress",
          assignedCount: progress.assignedCount,
          incompleteCount: progress.incompleteCount,
        },
        ipAddress: getClientIp(req),
      });
      res.json({ ...progress, feature: FEATURE_NOTE });
    },
  );

  app.get(
    "/api/onboarding/templates",
    auth,
    practiceGate,
    requireRole(...PHI_READ_ROLES),
    async (req, res) => {
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const templates = await storage.listChecklistTemplates(scope);
      const tasks = await storage.listChecklistTemplateTasks(scope);
      const listed = templates.map((template) =>
        publicChecklistTemplate(
          template,
          tasks.filter((task) => task.templateId === template.id),
        ),
      );
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "list",
        resourceType: "checklist_template",
        metadata: { count: templates.length },
        ipAddress: getClientIp(req),
      });
      res.json({
        emptyState: templates.length === 0 ? "no_templates" : "has_data",
        templates: listed,
        feature: FEATURE_NOTE,
      });
    },
  );

  app.post(
    "/api/onboarding/templates",
    auth,
    practiceGate,
    requireRole(...PHI_WRITE_ROLES),
    billingGate,
    async (req, res) => {
      const parsed = templateCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "invalid_input", details: parsed.error.flatten() });
      }
      const name = parsed.data.name.trim();
      if (!name) return res.status(400).json({ error: "name_required" });
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const template = await storage.createChecklistTemplate(scope, {
        name,
        patientType: parsed.data.patientType ?? "all",
        active: parsed.data.active ?? true,
      });
      const createdTasks = [];
      for (const [index, task] of (parsed.data.tasks ?? []).entries()) {
        const title = task.title.trim();
        if (!title) continue;
        createdTasks.push(
          await storage.createChecklistTemplateTask(scope, {
            templateId: template.id,
            title,
            description:
              task.description === undefined
                ? null
                : task.description === null
                  ? null
                  : task.description.trim() || null,
            sortOrder: task.sortOrder ?? index,
          }),
        );
      }
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "create",
        resourceType: "checklist_template",
        resourceId: template.id,
        metadata: {
          fields: Object.keys(parsed.data),
          patientType: template.patientType,
          taskCount: createdTasks.length,
        },
        ipAddress: getClientIp(req),
      });
      res.status(201).json({
        template: publicChecklistTemplate(template, createdTasks),
        feature: FEATURE_NOTE,
      });
    },
  );

  app.get(
    "/api/onboarding/templates/:id",
    auth,
    practiceGate,
    requireRole(...PHI_READ_ROLES),
    async (req, res) => {
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const loaded = await loadTemplateWithTasks(storage, scope, req.params.id);
      if (!loaded) return res.status(404).json({ error: "not_found" });
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "read",
        resourceType: "checklist_template",
        resourceId: loaded.template.id,
        metadata: { fields: ["id"], taskCount: loaded.tasks.length },
        ipAddress: getClientIp(req),
      });
      res.json({
        template: publicChecklistTemplate(loaded.template, loaded.tasks),
        feature: FEATURE_NOTE,
      });
    },
  );

  app.patch(
    "/api/onboarding/templates/:id",
    auth,
    practiceGate,
    requireRole(...PHI_WRITE_ROLES),
    billingGate,
    async (req, res) => {
      const parsed = templatePatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "invalid_input" });
      }
      const keys = Object.keys(parsed.data);
      if (keys.length === 0) {
        return res.status(400).json({ error: "empty_patch" });
      }
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const existing = await storage.getChecklistTemplate(scope, req.params.id);
      if (!existing) return res.status(404).json({ error: "not_found" });
      let name: string | undefined;
      if (parsed.data.name !== undefined) {
        name = parsed.data.name.trim();
        if (!name) return res.status(400).json({ error: "name_required" });
      }
      const row = await storage.updateChecklistTemplate(scope, existing.id, {
        name,
        patientType: parsed.data.patientType,
        active: parsed.data.active,
      });
      if (!row) return res.status(404).json({ error: "not_found" });
      const tasks = await storage.listChecklistTemplateTasks(scope, row.id);
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "update",
        resourceType: "checklist_template",
        resourceId: row.id,
        metadata: { fields: keys },
        ipAddress: getClientIp(req),
      });
      res.json({ template: publicChecklistTemplate(row, tasks) });
    },
  );

  app.delete(
    "/api/onboarding/templates/:id",
    auth,
    practiceGate,
    requireRole(...PHI_WRITE_ROLES),
    billingGate,
    async (req, res) => {
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const existing = await storage.getChecklistTemplate(scope, req.params.id);
      if (!existing) return res.status(404).json({ error: "not_found" });
      const assigned = await storage.countPatientChecklistsForTemplate(
        scope,
        existing.id,
      );
      if (assigned > 0) {
        return res.status(409).json({ error: "template_in_use", assigned });
      }
      const deleted = await storage.deleteChecklistTemplate(scope, existing.id);
      if (!deleted) return res.status(404).json({ error: "not_found" });
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "delete",
        resourceType: "checklist_template",
        resourceId: existing.id,
        metadata: { fields: ["id"] },
        ipAddress: getClientIp(req),
      });
      res.json({ ok: true });
    },
  );

  app.post(
    "/api/onboarding/templates/:id/tasks",
    auth,
    practiceGate,
    requireRole(...PHI_WRITE_ROLES),
    billingGate,
    async (req, res) => {
      const parsed = templateTaskCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "invalid_input" });
      }
      const title = parsed.data.title.trim();
      if (!title) return res.status(400).json({ error: "title_required" });
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const parent = await storage.getChecklistTemplate(scope, req.params.id);
      if (!parent) return res.status(404).json({ error: "not_found" });
      const row = await storage.createChecklistTemplateTask(scope, {
        templateId: parent.id,
        title,
        description:
          parsed.data.description === undefined
            ? null
            : parsed.data.description === null
              ? null
              : parsed.data.description.trim() || null,
        sortOrder: parsed.data.sortOrder ?? 0,
      });
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "create",
        resourceType: "checklist_template_task",
        resourceId: row.id,
        metadata: { fields: Object.keys(parsed.data), templateId: parent.id },
        ipAddress: getClientIp(req),
      });
      res.status(201).json({ task: publicTemplateTask(row) });
    },
  );

  app.patch(
    "/api/onboarding/template-tasks/:id",
    auth,
    practiceGate,
    requireRole(...PHI_WRITE_ROLES),
    billingGate,
    async (req, res) => {
      const parsed = templateTaskPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "invalid_input" });
      }
      const keys = Object.keys(parsed.data);
      if (keys.length === 0) {
        return res.status(400).json({ error: "empty_patch" });
      }
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const existing = await storage.getChecklistTemplateTask(scope, req.params.id);
      if (!existing) return res.status(404).json({ error: "not_found" });
      let title: string | undefined;
      if (parsed.data.title !== undefined) {
        title = parsed.data.title.trim();
        if (!title) return res.status(400).json({ error: "title_required" });
      }
      let description: string | null | undefined;
      if (parsed.data.description !== undefined) {
        description =
          parsed.data.description === null
            ? null
            : parsed.data.description.trim() || null;
      }
      const row = await storage.updateChecklistTemplateTask(scope, existing.id, {
        title,
        description,
        sortOrder: parsed.data.sortOrder,
      });
      if (!row) return res.status(404).json({ error: "not_found" });
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "update",
        resourceType: "checklist_template_task",
        resourceId: row.id,
        metadata: { fields: keys },
        ipAddress: getClientIp(req),
      });
      res.json({ task: publicTemplateTask(row) });
    },
  );

  app.delete(
    "/api/onboarding/template-tasks/:id",
    auth,
    practiceGate,
    requireRole(...PHI_WRITE_ROLES),
    billingGate,
    async (req, res) => {
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const existing = await storage.getChecklistTemplateTask(scope, req.params.id);
      if (!existing) return res.status(404).json({ error: "not_found" });
      const deleted = await storage.deleteChecklistTemplateTask(
        scope,
        existing.id,
      );
      if (!deleted) return res.status(404).json({ error: "not_found" });
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "delete",
        resourceType: "checklist_template_task",
        resourceId: existing.id,
        metadata: { fields: ["id"], templateId: existing.templateId },
        ipAddress: getClientIp(req),
      });
      res.json({ ok: true });
    },
  );

  app.get(
    "/api/onboarding/patient-checklists",
    auth,
    practiceGate,
    requireRole(...PHI_READ_ROLES),
    async (req, res) => {
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const patientId =
        typeof req.query.patientId === "string" ? req.query.patientId : undefined;
      const rows = await storage.listPatientChecklists(scope, patientId);
      const allTasks = await storage.listPatientChecklistTasks(scope);
      const checklists = rows.map((row) =>
        publicPatientChecklist(
          row,
          allTasks.filter((task) => task.patientChecklistId === row.id),
        ),
      );
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "list",
        resourceType: "patient_checklist",
        metadata: {
          count: checklists.length,
          filteredByPatient: Boolean(patientId),
        },
        ipAddress: getClientIp(req),
      });
      res.json({
        emptyState: rows.length === 0 ? "no_checklists" : "has_data",
        checklists,
        feature: FEATURE_NOTE,
      });
    },
  );

  app.post(
    "/api/onboarding/patient-checklists",
    auth,
    practiceGate,
    requireRole(...PHI_WRITE_ROLES),
    billingGate,
    async (req, res) => {
      const parsed = assignSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "invalid_input" });
      }
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const patient = await storage.getPatient(scope, parsed.data.patientId);
      if (!patient) return res.status(404).json({ error: "patient_not_found" });
      const loaded = await loadTemplateWithTasks(
        storage,
        scope,
        parsed.data.templateId,
      );
      if (!loaded) return res.status(404).json({ error: "template_not_found" });
      if (!loaded.template.active) {
        return res.status(400).json({ error: "template_inactive" });
      }
      const checklist = await storage.createPatientChecklist(scope, {
        patientId: patient.id,
        templateId: loaded.template.id,
        templateName: loaded.template.name,
        status: loaded.tasks.length === 0 ? "not_started" : "not_started",
        notes: parsed.data.notes ?? null,
      });
      const createdTasks = [];
      for (const task of loaded.tasks) {
        createdTasks.push(
          await storage.createPatientChecklistTask(scope, {
            patientChecklistId: checklist.id,
            title: task.title,
            done: false,
          }),
        );
      }
      const synced = await syncPatientChecklistStatus(
        storage,
        scope,
        checklist.id,
      );
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "create",
        resourceType: "patient_checklist",
        resourceId: checklist.id,
        metadata: {
          fields: ["patientId", "templateId"],
          templateId: loaded.template.id,
          taskCount: createdTasks.length,
        },
        ipAddress: getClientIp(req),
      });
      res.status(201).json({
        checklist: publicPatientChecklist(synced ?? checklist, createdTasks),
        feature: FEATURE_NOTE,
      });
    },
  );

  app.get(
    "/api/onboarding/patient-checklists/:id",
    auth,
    practiceGate,
    requireRole(...PHI_READ_ROLES),
    async (req, res) => {
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const loaded = await loadPatientChecklistWithTasks(
        storage,
        scope,
        req.params.id,
      );
      if (!loaded) return res.status(404).json({ error: "not_found" });
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "read",
        resourceType: "patient_checklist",
        resourceId: loaded.row.id,
        metadata: { fields: ["id"], taskCount: loaded.tasks.length },
        ipAddress: getClientIp(req),
      });
      res.json({
        checklist: publicPatientChecklist(loaded.row, loaded.tasks),
        feature: FEATURE_NOTE,
      });
    },
  );

  app.patch(
    "/api/onboarding/patient-checklists/:id",
    auth,
    practiceGate,
    requireRole(...PHI_WRITE_ROLES),
    billingGate,
    async (req, res) => {
      const parsed = patientChecklistPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "invalid_input" });
      }
      const keys = Object.keys(parsed.data);
      if (keys.length === 0) {
        return res.status(400).json({ error: "empty_patch" });
      }
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const existing = await storage.getPatientChecklist(scope, req.params.id);
      if (!existing) return res.status(404).json({ error: "not_found" });
      const row = await storage.updatePatientChecklist(scope, existing.id, {
        notes: parsed.data.notes,
        status: parsed.data.status,
      });
      if (!row) return res.status(404).json({ error: "not_found" });
      const tasks = await storage.listPatientChecklistTasks(scope, row.id);
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "update",
        resourceType: "patient_checklist",
        resourceId: row.id,
        metadata: { fields: keys },
        ipAddress: getClientIp(req),
      });
      res.json({ checklist: publicPatientChecklist(row, tasks) });
    },
  );

  app.delete(
    "/api/onboarding/patient-checklists/:id",
    auth,
    practiceGate,
    requireRole(...PHI_DELETE_ROLES),
    billingGate,
    async (req, res) => {
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const existing = await storage.getPatientChecklist(scope, req.params.id);
      if (!existing) return res.status(404).json({ error: "not_found" });
      const deleted = await storage.deletePatientChecklist(scope, existing.id);
      if (!deleted) return res.status(404).json({ error: "not_found" });
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "delete",
        resourceType: "patient_checklist",
        resourceId: existing.id,
        metadata: { fields: ["id"] },
        ipAddress: getClientIp(req),
      });
      res.json({ ok: true });
    },
  );

  app.post(
    "/api/onboarding/patient-checklists/:id/tasks/:taskId/toggle",
    auth,
    practiceGate,
    requireRole(...PHI_WRITE_ROLES),
    billingGate,
    async (req, res) => {
      const parsed = taskToggleSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ error: "invalid_input" });
      }
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const parent = await storage.getPatientChecklist(scope, req.params.id);
      if (!parent) return res.status(404).json({ error: "not_found" });
      const task = await storage.getPatientChecklistTask(scope, req.params.taskId);
      if (!task || task.patientChecklistId !== parent.id) {
        return res.status(404).json({ error: "not_found" });
      }
      const done = parsed.data.done ?? !task.done;
      const completedAt = done ? task.completedAt ?? ctx.now() : null;
      const updated = await storage.updatePatientChecklistTask(scope, task.id, {
        done,
        completedAt,
        assigneeName: parsed.data.assigneeName,
        notes: parsed.data.notes,
      });
      if (!updated) return res.status(404).json({ error: "not_found" });
      const synced = await syncPatientChecklistStatus(storage, scope, parent.id);
      const tasks = await storage.listPatientChecklistTasks(scope, parent.id);
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "update",
        resourceType: "patient_checklist_task",
        resourceId: updated.id,
        metadata: {
          fields: Object.keys(parsed.data).concat(["done"]),
          checklistId: parent.id,
          done,
        },
        ipAddress: getClientIp(req),
      });
      res.json({
        task: publicPatientChecklist(synced ?? parent, tasks).tasks.find(
          (item) => item.id === updated.id,
        ),
        checklist: publicPatientChecklist(synced ?? parent, tasks),
      });
    },
  );
}
