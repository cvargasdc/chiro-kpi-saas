import { describe, expect, it } from "vitest";
import {
  decryptAesGcm,
  encryptAesGcm,
  isAesGcmCiphertext,
} from "../server/crypto/aes-gcm";
import {
  decryptPhiString,
  decryptStoredPatient,
  encryptPhiString,
} from "../server/crypto/fields";
import { createMemoryStorage } from "../server/storage/memory";

const KEY = "test-phi-encryption-key-min-32-chars!!";
const OTHER = "other-phi-encryption-key-min-32-xx";

describe("AES-256-GCM helper", () => {
  it("round-trips and is not plaintext", () => {
    const enc = encryptAesGcm("alice@clinic.test", KEY);
    expect(isAesGcmCiphertext(enc)).toBe(true);
    expect(enc).not.toContain("alice@clinic.test");
    expect(decryptAesGcm(enc, KEY)).toBe("alice@clinic.test");
  });

  it("fails closed with the wrong key", () => {
    const enc = encryptAesGcm("555-0100", KEY);
    expect(() => decryptAesGcm(enc, OTHER)).toThrow();
  });
});

describe("PHI field helper", () => {
  it("encrypts null as null and decrypts legacy plaintext", () => {
    expect(encryptPhiString(null, KEY)).toBeNull();
    expect(encryptPhiString("", KEY)).toBeNull();
    expect(decryptPhiString("1980-01-15", KEY)).toBe("1980-01-15");
    expect(decryptPhiString(null, KEY)).toBeNull();
  });

  it("rejects a short key when encrypting a value", () => {
    expect(() => encryptPhiString("a@b.co", "short")).toThrow(/PHI_ENCRYPTION_KEY/);
  });
});

describe("patient storage ciphertext", () => {
  it("stores email, phone, and DOB as ciphertext and decrypts on read", async () => {
    const store = createMemoryStorage({ phiEncryptionKey: KEY });
    const org = await store.createOrganization({ name: "Org" });
    const practice = await store.createPractice({ orgId: org.id, name: "Clinic" });
    const scope = { orgId: org.id, practiceId: practice.id };

    const created = await store.createPatient(scope, {
      name: "Alice Patient",
      email: "alice@clinic.test",
      phone: "555-0100",
      dateOfBirth: "1980-01-15",
      notes: "LBP after lift",
    });
    expect(created.email).toBe("alice@clinic.test");
    expect(created.phone).toBe("555-0100");
    expect(created.dateOfBirth).toBe("1980-01-15");
    expect(created.notes).toBe("LBP after lift");

    const raw = store.patients[0];
    expect(raw.email).not.toBe("alice@clinic.test");
    expect(raw.phone).not.toBe("555-0100");
    expect(raw.dateOfBirth).not.toBe("1980-01-15");
    expect(raw.email).toMatch(/^v1:/);
    expect(raw.phone).toMatch(/^v1:/);
    expect(raw.dateOfBirth).toMatch(/^v1:/);
    expect(raw.notes).toMatch(/^v1:/);
    expect(JSON.stringify(raw)).not.toContain("alice@clinic.test");
    expect(JSON.stringify(raw)).not.toContain("555-0100");
    expect(JSON.stringify(raw)).not.toContain("1980-01-15");
    expect(JSON.stringify(raw)).not.toContain("LBP after lift");

    const listed = await store.listPatients(scope);
    expect(listed[0].email).toBe("alice@clinic.test");
    expect(listed[0].phone).toBe("555-0100");
    expect(listed[0].dateOfBirth).toBe("1980-01-15");

    const updated = await store.updatePatient(scope, created.id, {
      email: "alice2@clinic.test",
    });
    expect(updated?.email).toBe("alice2@clinic.test");
    expect(store.patients[0].email).toMatch(/^v1:/);
    expect(store.patients[0].email).not.toContain("alice2@clinic.test");
  });

  it("decryptStoredPatient leaves names in plaintext", () => {
    const row = decryptStoredPatient(
      {
        id: "p1",
        orgId: "o1",
        practiceId: "pr1",
        name: "Bob",
        email: encryptPhiString("bob@clinic.test", KEY),
        phone: null,
        dateOfBirth: null,
        condition: null,
        status: "active",
        patientType: "new",
        typeName: null,
        referralSourceId: null,
        referralSource: null,
        day1Date: null,
        day2Date: null,
        careStatus: "new",
        converted: false,
        conversionDate: null,
        planType: null,
        notes: encryptPhiString("lumbar notes", KEY),
        createdBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      KEY,
    );
    expect(row.name).toBe("Bob");
    expect(row.email).toBe("bob@clinic.test");
    expect(row.notes).toBe("lumbar notes");
  });
});

describe("patient onboarding notes ciphertext", () => {
  it("encrypts checklist and task notes at rest", async () => {
    const store = createMemoryStorage({ phiEncryptionKey: KEY });
    const org = await store.createOrganization({ name: "Org" });
    const practice = await store.createPractice({ orgId: org.id, name: "Clinic" });
    const scope = { orgId: org.id, practiceId: practice.id };
    const patient = await store.createPatient(scope, { name: "Alice Patient" });
    const checklist = await store.createPatientChecklist(scope, {
      patientId: patient.id,
      templateName: "Day-1",
      notes: "Prefers mornings",
    });
    expect(checklist.notes).toBe("Prefers mornings");
    expect(store.patientChecklists[0].notes).toMatch(/^v1:/);
    expect(JSON.stringify(store.patientChecklists[0])).not.toContain(
      "Prefers mornings",
    );

    const task = await store.createPatientChecklistTask(scope, {
      patientChecklistId: checklist.id,
      title: "Intake",
      notes: "Left-side preference",
    });
    expect(task.notes).toBe("Left-side preference");
    expect(store.patientChecklistTasks[0].notes).toMatch(/^v1:/);
    expect(JSON.stringify(store.patientChecklistTasks[0])).not.toContain(
      "Left-side preference",
    );
  });
});
