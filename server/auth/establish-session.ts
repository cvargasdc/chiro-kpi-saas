import type { Request } from "express";

export function establishSession(
  req: Request,
  userId: string,
  orgId: string,
  practiceId: string,
  issuedAt: Date,
): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = userId;
      req.session.activeOrgId = orgId;
      req.session.activePracticeId = practiceId;
      req.session.authIssuedAt = issuedAt.toISOString();
      req.session.save((saveErr) => (saveErr ? reject(saveErr) : resolve()));
    });
  });
}

export function destroySession(req: Request): Promise<void> {
  return new Promise((resolve) => {
    req.session.destroy(() => resolve());
  });
}
