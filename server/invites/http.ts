import type { Express } from "express";
import { z } from "zod";
import {
  normalizeEmail,
  normalizeUsername,
  USERNAME_PATTERN,
  validatePassword,
} from "@shared/password-policy";
import { isMembershipRole, ORG_ADMIN_ROLES } from "@shared/roles";
import { logAudit } from "../audit/logAudit";
import { establishSession } from "../auth/establish-session";
import { publicUser } from "../auth/http";
import { authenticate, getClientIp, requirePracticeMembership, requireRole } from "../auth/middleware";
import { hashPassword, verifyPassword } from "../auth/password";
import { generateUrlToken, hashToken } from "../auth/tokens";
import type { HttpContext } from "../http-context";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const createInviteSchema = z.object({
  email: z.string().email().max(320),
  role: z.string().min(1),
});

const acceptInviteSchema = z.object({
  token: z.string().min(1).max(512),
  password: z.string().optional(),
  username: z.string().optional(),
  displayName: z.string().optional(),
});

export function registerInviteRoutes(app: Express, ctx: HttpContext): void {
  const { storage } = ctx;
  const auth = authenticate(storage);
  const practiceGate = requirePracticeMembership(storage);
  const adminGate = requireRole(...ORG_ADMIN_ROLES);

  app.post(
    "/api/practices/:practiceId/invites",
    auth,
    practiceGate,
    adminGate,
    async (req, res) => {
      const parsed = createInviteSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "invalid_input" });
      }
      if (!isMembershipRole(parsed.data.role)) {
        return res.status(400).json({ error: "invalid_role" });
      }
      const tenant = req.tenant!;
      const now = ctx.now();
      const email = normalizeEmail(parsed.data.email);
      const existingPending = await storage.getPendingInvitationByEmail(
        tenant.practiceId,
        email,
        now,
      );
      if (existingPending) {
        return res.status(409).json({ error: "invite_already_pending" });
      }
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        const already = await storage.getPracticeMembership(
          existingUser.id,
          tenant.practiceId,
        );
        if (already) {
          return res.status(409).json({ error: "already_a_member" });
        }
      }

      const raw = generateUrlToken();
      const invite = await storage.createInvitation({
        email,
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        role: parsed.data.role,
        tokenHash: hashToken(raw),
        expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
        invitedBy: req.currentUser!.id,
      });
      const actionUrl = `${ctx.publicBaseUrl.replace(/\/$/, "")}/invite/accept?token=${encodeURIComponent(raw)}`;
      await ctx.mailer.send({
        to: email,
        template: "practice_invite",
        subject: "Invitation to join a practice on Chiro-KPI",
        actionUrl,
        text: [
          `You were invited to join ${tenant.practiceName} (${tenant.orgName}) as ${parsed.data.role}.`,
          "Open this link within 7 days to accept:",
          actionUrl,
          "",
          "If you were not expecting this, you can ignore this email.",
        ].join("\n"),
      });
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "invite_created",
        resourceType: "invitation",
        resourceId: invite.id,
        metadata: { role: parsed.data.role },
        ipAddress: getClientIp(req),
      });
      res.status(201).json({
        invite: {
          id: invite.id,
          email: invite.email,
          role: invite.role,
          expiresAt: invite.expiresAt.toISOString(),
          practiceId: invite.practiceId,
          orgId: invite.orgId,
        },
      });
    },
  );

  app.get(
    "/api/practices/:practiceId/invites",
    auth,
    practiceGate,
    adminGate,
    async (req, res) => {
      const tenant = req.tenant!;
      const rows = await storage.listPendingInvitationsForPractice(
        { orgId: tenant.orgId, practiceId: tenant.practiceId },
        ctx.now(),
      );
      res.json({
        invites: rows.map((row) => ({
          id: row.id,
          email: row.email,
          role: row.role,
          expiresAt: row.expiresAt.toISOString(),
          invitedBy: row.invitedBy,
          createdAt: row.createdAt.toISOString(),
        })),
      });
    },
  );

  app.delete(
    "/api/practices/:practiceId/invites/:inviteId",
    auth,
    practiceGate,
    adminGate,
    async (req, res) => {
      const tenant = req.tenant!;
      const invite = await storage.getInvitationById(req.params.inviteId);
      if (
        !invite ||
        invite.practiceId !== tenant.practiceId ||
        invite.orgId !== tenant.orgId
      ) {
        return res.status(404).json({ error: "not_found" });
      }
      const revoked = await storage.revokeInvitation(invite.id, ctx.now());
      if (!revoked) {
        return res.status(409).json({ error: "invite_not_pending" });
      }
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "invite_revoked",
        resourceType: "invitation",
        resourceId: invite.id,
        metadata: { role: invite.role },
        ipAddress: getClientIp(req),
      });
      res.json({ ok: true });
    },
  );

  app.get("/api/invites/preview", async (req, res) => {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    if (!token) {
      return res.status(400).json({ error: "invalid_input" });
    }
    const invite = await storage.getInvitationByTokenHash(hashToken(token));
    const now = ctx.now();
    if (
      !invite ||
      invite.acceptedAt ||
      invite.revokedAt ||
      invite.expiresAt.getTime() <= now.getTime()
    ) {
      return res.status(400).json({ error: "invalid_or_expired_token" });
    }
    const practice = await storage.getPractice(invite.practiceId);
    const org = await storage.getOrganization(invite.orgId);
    const existingUser = await storage.getUserByEmail(invite.email);
    res.json({
      email: invite.email,
      role: invite.role,
      practiceName: practice?.name ?? "",
      orgName: org?.name ?? "",
      expiresAt: invite.expiresAt.toISOString(),
      existingUser: Boolean(existingUser),
    });
  });

  app.post("/api/invites/accept", async (req, res) => {
    const parsed = acceptInviteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_input" });
    }
    const now = ctx.now();
    const invite = await storage.getInvitationByTokenHash(hashToken(parsed.data.token));
    if (
      !invite ||
      invite.acceptedAt ||
      invite.revokedAt ||
      invite.expiresAt.getTime() <= now.getTime()
    ) {
      return res.status(400).json({ error: "invalid_or_expired_token" });
    }

    const existing = await storage.getUserByEmail(invite.email);
    let user = existing;

    if (existing) {
      if (req.currentUser && req.currentUser.id !== existing.id) {
        return res.status(403).json({ error: "invite_email_mismatch" });
      }
      if (!req.currentUser) {
        if (!parsed.data.password) {
          return res.status(401).json({ error: "login_required" });
        }
        const ok = await verifyPassword(parsed.data.password, existing.passwordHash);
        if (!ok) {
          return res.status(401).json({ error: "invalid_credentials" });
        }
      }
    } else {
      const policy = parsed.data.password
        ? validatePassword(parsed.data.password)
        : { ok: false as const, errors: ["Password is required"] };
      if (!policy.ok) {
        return res.status(400).json({ error: "password_policy", details: policy.errors });
      }
      const usernameRaw = parsed.data.username ?? "";
      if (!USERNAME_PATTERN.test(usernameRaw)) {
        return res.status(400).json({ error: "invalid_username" });
      }
      const displayName = (parsed.data.displayName ?? "").trim();
      if (!displayName) {
        return res.status(400).json({ error: "invalid_input" });
      }
      const username = normalizeUsername(usernameRaw);
      if (await storage.getUserByUsername(username)) {
        return res.status(409).json({ error: "username_taken" });
      }
      const passwordHash = await hashPassword(parsed.data.password!);
      user = await storage.createUser({
        email: invite.email,
        username,
        passwordHash,
        displayName,
      });
    }

    if (!user) {
      return res.status(500).json({ error: "internal_error" });
    }

    await storage.ensureOrgMembership({
      orgId: invite.orgId,
      userId: user.id,
      role: invite.role,
    });
    await storage.ensurePracticeMembership({
      orgId: invite.orgId,
      practiceId: invite.practiceId,
      userId: user.id,
      role: invite.role,
    });
    await storage.markInvitationAccepted(invite.id, now, user.id);
    await storage.touchLastLogin(user.id);
    await establishSession(req, user.id, invite.orgId, invite.practiceId, now);
    await logAudit(storage, {
      orgId: invite.orgId,
      practiceId: invite.practiceId,
      actorId: user.id,
      action: "invite_accepted",
      resourceType: "invitation",
      resourceId: invite.id,
      metadata: { role: invite.role },
      ipAddress: getClientIp(req),
    });

    const practice = await storage.getPractice(invite.practiceId);
    res.json({
      user: publicUser(user),
      practice: practice
        ? {
            id: practice.id,
            name: practice.name,
            orgId: practice.orgId,
            role: invite.role,
          }
        : null,
    });
  });
}
