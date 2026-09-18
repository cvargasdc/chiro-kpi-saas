import type { Express } from "express";
import { z } from "zod";
import {
  normalizeEmail,
  normalizeUsername,
  USERNAME_PATTERN,
  validatePassword,
} from "@shared/password-policy";
import type { HttpContext } from "../http-context";
import type { StoredUser } from "../storage/types";
import {
  beginMfaEnrollment,
  confirmMfaEnrollment,
  disableMfa,
  getMfaStatus,
  verifyMfaChallenge,
} from "./mfa";
import { authenticate, getClientIp } from "./middleware";
import { hashPassword, verifyPassword, verifyPasswordOrDummy } from "./password";
import { generateUrlToken, hashToken } from "./tokens";
import { establishSession } from "./establish-session";
import { logUserAudit } from "./audit-tenant";

const RESET_TTL_MS = 60 * 60 * 1000;
const GENERIC_FORGOT_MESSAGE =
  "If an account exists for that email, a reset link has been sent.";

const registerSchema = z.object({
  email: z.string().email().max(320),
  username: z.string().regex(USERNAME_PATTERN, "Username must be 3-64 characters (letters, numbers, . _ -)"),
  password: z.string(),
  displayName: z.string().min(1).max(120),
  organizationName: z.string().min(1).max(200),
  practiceName: z.string().min(1).max(200),
});

const loginSchema = z.object({
  login: z.string().min(1).max(320),
  password: z.string().min(1),
});

const forgotSchema = z.object({
  email: z.string().email().max(320),
});

const resetSchema = z.object({
  token: z.string().min(1).max(512),
  password: z.string(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string(),
});

const mfaCodeSchema = z.object({
  code: z.string().min(4).max(32),
});

const mfaVerifySchema = z.object({
  challengeToken: z.string().min(1).max(512),
  code: z.string().min(4).max(32),
});

const mfaDisableSchema = z.object({
  password: z.string().min(1),
  code: z.string().min(4).max(32),
});

const contextSchema = z.object({
  orgId: z.string().min(1),
  practiceId: z.string().min(1),
});

export function publicUser(user: StoredUser) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    status: user.status,
    mfa: getMfaStatus(user),
  };
}

async function firstPractice(ctx: HttpContext, userId: string) {
  const practices = await ctx.storage.listPracticesForUser(userId);
  return practices[0];
}

export function registerAuthRoutes(app: Express, ctx: HttpContext): void {
  const { storage } = ctx;
  const auth = authenticate(storage);

  app.post("/api/auth/register", async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    }
    const policy = validatePassword(parsed.data.password);
    if (!policy.ok) {
      return res.status(400).json({ error: "password_policy", details: policy.errors });
    }

    const email = normalizeEmail(parsed.data.email);
    const username = normalizeUsername(parsed.data.username);

    if (await storage.getUserByEmail(email)) {
      return res.status(409).json({ error: "email_taken" });
    }
    if (await storage.getUserByUsername(username)) {
      return res.status(409).json({ error: "username_taken" });
    }

    const passwordHash = await hashPassword(parsed.data.password);
    const user = await storage.createUser({
      email,
      username,
      passwordHash,
      displayName: parsed.data.displayName.trim(),
    });
    const org = await storage.createOrganization({
      name: parsed.data.organizationName.trim(),
    });
    const practice = await storage.createPractice({
      orgId: org.id,
      name: parsed.data.practiceName.trim(),
    });
    await storage.createOrgMembership({
      orgId: org.id,
      userId: user.id,
      role: "owner",
    });
    await storage.createPracticeMembership({
      orgId: org.id,
      practiceId: practice.id,
      userId: user.id,
      role: "owner",
    });
    await storage.touchLastLogin(user.id);
    await establishSession(req, user.id, org.id, practice.id, ctx.now());

    return res.status(201).json({
      user: publicUser(user),
      organization: { id: org.id, name: org.name },
      practice: { id: practice.id, name: practice.name, orgId: org.id, role: "owner" },
    });
  });

  app.post("/api/auth/login", async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_input" });
    }
    const user = await storage.getUserByLogin(parsed.data.login);
    const passwordOk = await verifyPasswordOrDummy(
      parsed.data.password,
      user?.passwordHash,
    );
    if (!user || user.status !== "active" || !passwordOk) {
      return res.status(401).json({ error: "invalid_credentials" });
    }

    if (user.mfaEnabled) {
      await new Promise<void>((resolve, reject) => {
        req.session.regenerate((err) => (err ? reject(err) : resolve()));
      });
      const challengeToken = ctx.mfaChallenges.issue(user.id, ctx.now());
      return res.json({
        mfaRequired: true,
        challengeToken,
        methods: ["totp"],
      });
    }

    const first = await firstPractice(ctx, user.id);
    await storage.touchLastLogin(user.id);
    await establishSession(
      req,
      user.id,
      first?.orgId ?? "",
      first?.id ?? "",
      ctx.now(),
    );

    return res.json({
      mfaRequired: false,
      user: publicUser(user),
      practice: first
        ? { id: first.id, name: first.name, orgId: first.orgId, role: first.role }
        : null,
    });
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.clearCookie("chirokpi.sid");
      res.json({ ok: true });
    });
  });

  app.post("/api/auth/forgot-password", async (req, res) => {
    const parsed = forgotSchema.safeParse(req.body);
    const generic = { ok: true, message: GENERIC_FORGOT_MESSAGE };
    if (!parsed.success) {
      return res.json(generic);
    }

    const ip = getClientIp(req);
    const email = normalizeEmail(parsed.data.email);
    const now = ctx.now();
    const allowedIp = ctx.forgotPasswordLimiter.allow(`ip:${ip}`, now);
    const allowedEmail = ctx.forgotPasswordLimiter.allow(`email:${email}`, now);
    if (!allowedIp || !allowedEmail) {
      return res.json(generic);
    }

    const user = await storage.getUserByEmail(email);
    if (!user || user.status !== "active") {
      return res.json(generic);
    }

    const raw = generateUrlToken();
    await storage.createPasswordResetToken({
      userId: user.id,
      tokenHash: hashToken(raw),
      expiresAt: new Date(now.getTime() + RESET_TTL_MS),
    });
    const actionUrl = `${ctx.publicBaseUrl.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(raw)}`;
    await ctx.mailer.send({
      to: user.email,
      template: "password_reset",
      subject: "Reset your Chiro-KPI password",
      actionUrl,
      text: [
        "We received a request to reset the password for your Chiro-KPI account.",
        "Open this link within 1 hour to choose a new password:",
        actionUrl,
        "",
        "If you did not request this, you can ignore this email.",
      ].join("\n"),
    });
    await logUserAudit(storage, {
      userId: user.id,
      actorId: user.id,
      action: "password_reset_requested",
      resourceType: "user",
      resourceId: user.id,
      ipAddress: ip,
    });
    return res.json(generic);
  });

  app.post("/api/auth/reset-password", async (req, res) => {
    const parsed = resetSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_input" });
    }
    const policy = validatePassword(parsed.data.password);
    if (!policy.ok) {
      return res.status(400).json({ error: "password_policy", details: policy.errors });
    }

    const now = ctx.now();
    const row = await storage.getPasswordResetTokenByHash(hashToken(parsed.data.token));
    if (!row || row.usedAt || row.expiresAt.getTime() <= now.getTime()) {
      return res.status(400).json({ error: "invalid_or_expired_token" });
    }
    const user = await storage.getUserById(row.userId);
    if (!user || user.status !== "active") {
      return res.status(400).json({ error: "invalid_or_expired_token" });
    }

    const passwordHash = await hashPassword(parsed.data.password);
    await storage.updateUser(user.id, {
      passwordHash,
      credentialsChangedAt: now,
    });
    await storage.invalidatePasswordResetTokensForUser(user.id, now);
    await storage.markPasswordResetTokenUsed(row.id, now);

    const first = await firstPractice(ctx, user.id);
    await establishSession(
      req,
      user.id,
      first?.orgId ?? "",
      first?.id ?? "",
      now,
    );
    await logUserAudit(storage, {
      userId: user.id,
      actorId: user.id,
      action: "password_reset_completed",
      resourceType: "user",
      resourceId: user.id,
      ipAddress: getClientIp(req),
    });
    return res.json({ ok: true });
  });

  app.post("/api/auth/change-password", auth, async (req, res) => {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_input" });
    }
    const policy = validatePassword(parsed.data.newPassword);
    if (!policy.ok) {
      return res.status(400).json({ error: "password_policy", details: policy.errors });
    }
    const user = await storage.getUserById(req.currentUser!.id);
    if (!user) {
      return res.status(401).json({ error: "unauthenticated" });
    }
    const ok = await verifyPassword(parsed.data.currentPassword, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: "invalid_credentials" });
    }
    const now = ctx.now();
    const passwordHash = await hashPassword(parsed.data.newPassword);
    await storage.updateUser(user.id, {
      passwordHash,
      credentialsChangedAt: now,
    });
    await storage.invalidatePasswordResetTokensForUser(user.id, now);
    const first = await firstPractice(ctx, user.id);
    await establishSession(
      req,
      user.id,
      first?.orgId ?? req.session.activeOrgId ?? "",
      first?.id ?? req.session.activePracticeId ?? "",
      now,
    );
    await logUserAudit(storage, {
      userId: user.id,
      actorId: user.id,
      action: "password_changed",
      resourceType: "user",
      resourceId: user.id,
      ipAddress: getClientIp(req),
    });
    res.json({ ok: true });
  });

  app.get("/api/me", auth, async (req, res) => {
    const fresh = await storage.getUserById(req.currentUser!.id);
    if (!fresh) {
      return res.status(401).json({ error: "unauthenticated" });
    }
    const [organizations, practices] = await Promise.all([
      storage.listOrganizationsForUser(fresh.id),
      storage.listPracticesForUser(fresh.id),
    ]);
    const activePractice = practices.find(
      (p) => p.id === req.session.activePracticeId,
    ) ?? practices[0];
    const activeOrg = organizations.find(
      (o) => o.id === (activePractice?.orgId ?? req.session.activeOrgId),
    ) ?? organizations[0];

    res.json({
      user: publicUser(fresh),
      organizations: organizations.map((o) => ({
        id: o.id,
        name: o.name,
        role: o.role,
      })),
      practices: practices.map((p) => ({
        id: p.id,
        name: p.name,
        orgId: p.orgId,
        role: p.role,
      })),
      active: activePractice
        ? {
            orgId: activePractice.orgId,
            orgName: activeOrg?.name ?? "",
            practiceId: activePractice.id,
            practiceName: activePractice.name,
            role: activePractice.role,
          }
        : null,
    });
  });

  app.post("/api/session/context", auth, async (req, res) => {
    const parsed = contextSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_input" });
    }
    const membership = await storage.getPracticeMembership(
      req.currentUser!.id,
      parsed.data.practiceId,
    );
    const practice = await storage.getPractice(parsed.data.practiceId);
    if (
      !membership ||
      !practice ||
      practice.orgId !== parsed.data.orgId ||
      practice.status !== "active"
    ) {
      return res.status(403).json({ error: "practice_access_denied" });
    }
    req.session.activeOrgId = practice.orgId;
    req.session.activePracticeId = practice.id;
    req.session.save((err) => {
      if (err) return res.status(500).json({ error: "session_error" });
      res.json({
        orgId: practice.orgId,
        practiceId: practice.id,
        practiceName: practice.name,
        role: membership.role,
      });
    });
  });

  app.post("/api/auth/mfa/enroll/start", auth, async (req, res) => {
    if (!ctx.mfaEncryptionKey) {
      return res.status(503).json({ error: "mfa_not_configured" });
    }
    const user = await storage.getUserById(req.currentUser!.id);
    if (!user) {
      return res.status(401).json({ error: "unauthenticated" });
    }
    if (user.mfaEnabled) {
      return res.status(409).json({ error: "mfa_already_enabled" });
    }
    const started = beginMfaEnrollment({
      accountName: user.email,
      encryptionKey: ctx.mfaEncryptionKey,
    });
    await storage.updateUser(user.id, {
      mfaPendingSecretEnc: started.secretEnc,
    });
    await logUserAudit(storage, {
      userId: user.id,
      actorId: user.id,
      action: "mfa_enroll_started",
      resourceType: "mfa",
      resourceId: user.id,
      ipAddress: getClientIp(req),
    });
    res.json({
      secret: started.secret,
      otpauthUri: started.otpauthUri,
      mfaEnabled: false,
    });
  });

  app.post("/api/auth/mfa/enroll/confirm", auth, async (req, res) => {
    const parsed = mfaCodeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_input" });
    }
    if (!ctx.mfaEncryptionKey) {
      return res.status(503).json({ error: "mfa_not_configured" });
    }
    const user = await storage.getUserById(req.currentUser!.id);
    if (!user) {
      return res.status(401).json({ error: "unauthenticated" });
    }
    if (user.mfaEnabled) {
      return res.status(409).json({ error: "mfa_already_enabled" });
    }
    if (!user.mfaPendingSecretEnc) {
      return res.status(400).json({ error: "mfa_enrollment_not_started" });
    }
    const confirmed = confirmMfaEnrollment({
      pendingSecretEnc: user.mfaPendingSecretEnc,
      code: parsed.data.code,
      encryptionKey: ctx.mfaEncryptionKey,
      now: ctx.now(),
    });
    if (!confirmed) {
      return res.status(400).json({ error: "invalid_code" });
    }
    const now = ctx.now();
    await storage.updateUser(user.id, {
      mfaEnabled: true,
      mfaMethod: "totp",
      mfaSecretEnc: confirmed.secretEnc,
      mfaPendingSecretEnc: null,
      mfaRecoveryCodesHash: confirmed.recoveryHashesJson,
      mfaEnrolledAt: now,
    });
    await logUserAudit(storage, {
      userId: user.id,
      actorId: user.id,
      action: "mfa_enroll_completed",
      resourceType: "mfa",
      resourceId: user.id,
      ipAddress: getClientIp(req),
    });
    res.json({
      mfaEnabled: true,
      recoveryCodes: confirmed.recoveryCodes,
    });
  });

  app.post("/api/auth/mfa/verify", async (req, res) => {
    const parsed = mfaVerifySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_input" });
    }
    if (!ctx.mfaEncryptionKey) {
      return res.status(503).json({ error: "mfa_not_configured" });
    }
    const now = ctx.now();
    const challenge = ctx.mfaChallenges.peek(parsed.data.challengeToken, now);
    if (!challenge) {
      return res.status(401).json({ error: "invalid_or_expired_challenge" });
    }
    const user = await storage.getUserById(challenge.userId);
    if (!user || user.status !== "active" || !user.mfaEnabled || !user.mfaSecretEnc) {
      ctx.mfaChallenges.consume(parsed.data.challengeToken);
      return res.status(401).json({ error: "invalid_or_expired_challenge" });
    }
    const verified = verifyMfaChallenge({
      secretEnc: user.mfaSecretEnc,
      code: parsed.data.code,
      encryptionKey: ctx.mfaEncryptionKey,
      now,
      recoveryHashesJson: user.mfaRecoveryCodesHash,
    });
    if (!verified.ok) {
      ctx.mfaChallenges.recordFailure(parsed.data.challengeToken);
      return res.status(401).json({ error: "invalid_code" });
    }
    ctx.mfaChallenges.consume(parsed.data.challengeToken);
    if (verified.remainingRecoveryHashes !== undefined) {
      await storage.updateUser(user.id, {
        mfaRecoveryCodesHash: verified.remainingRecoveryHashes,
      });
    }
    const first = await firstPractice(ctx, user.id);
    await storage.touchLastLogin(user.id);
    await establishSession(
      req,
      user.id,
      first?.orgId ?? "",
      first?.id ?? "",
      now,
    );
    await logUserAudit(storage, {
      userId: user.id,
      actorId: user.id,
      action: "mfa_verified",
      resourceType: "mfa",
      resourceId: user.id,
      ipAddress: getClientIp(req),
    });
    res.json({
      mfaRequired: false,
      user: publicUser({ ...user, mfaEnabled: true }),
      practice: first
        ? { id: first.id, name: first.name, orgId: first.orgId, role: first.role }
        : null,
    });
  });

  app.post("/api/auth/mfa/disable", auth, async (req, res) => {
    const parsed = mfaDisableSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_input" });
    }
    if (!ctx.mfaEncryptionKey) {
      return res.status(503).json({ error: "mfa_not_configured" });
    }
    const user = await storage.getUserById(req.currentUser!.id);
    if (!user) {
      return res.status(401).json({ error: "unauthenticated" });
    }
    const passwordOk = await verifyPassword(parsed.data.password, user.passwordHash);
    if (!passwordOk) {
      return res.status(401).json({ error: "invalid_credentials" });
    }
    if (!user.mfaEnabled || !user.mfaSecretEnc) {
      return res.status(400).json({ error: "mfa_not_enabled" });
    }
    const now = ctx.now();
    const verified = verifyMfaChallenge({
      secretEnc: user.mfaSecretEnc,
      code: parsed.data.code,
      encryptionKey: ctx.mfaEncryptionKey,
      now,
      recoveryHashesJson: user.mfaRecoveryCodesHash,
    });
    if (!verified.ok) {
      return res.status(401).json({ error: "invalid_code" });
    }
    await storage.updateUser(user.id, {
      ...disableMfa(),
      credentialsChangedAt: now,
    });
    const first = await firstPractice(ctx, user.id);
    await establishSession(
      req,
      user.id,
      first?.orgId ?? req.session.activeOrgId ?? "",
      first?.id ?? req.session.activePracticeId ?? "",
      now,
    );
    await logUserAudit(storage, {
      userId: user.id,
      actorId: user.id,
      action: "mfa_disabled",
      resourceType: "mfa",
      resourceId: user.id,
      ipAddress: getClientIp(req),
    });
    res.json({ ok: true, mfaEnabled: false });
  });
}
