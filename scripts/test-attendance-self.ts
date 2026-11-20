import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import * as attendance from "../src/modules/hr/attendance.service.js";
import { AppError } from "../src/utils/AppError.js";
import { hashPassword } from "../src/lib/password.js";

const prisma = new PrismaClient();
const results: Array<{ name: string; ok: boolean; detail?: string }> = [];

function pass(name: string) {
  results.push({ name, ok: true });
  console.log(`[PASS] ${name}`);
}
function fail(name: string, detail: string) {
  results.push({ name, ok: false, detail });
  console.error(`[FAIL] ${name}: ${detail}`);
}

async function cleanup(orgId: string, userIds: string[]) {
  await prisma.attendanceRecord.deleteMany({ where: { organizationId: orgId } });
  await prisma.employee.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
  if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function main() {
  console.log("=== Attendance self-service + HR ===\n");

  const leftovers = await prisma.organization.findMany({
    where: { code: "ATT_SELF_T" },
    select: { id: true },
  });
  for (const o of leftovers) {
    const emps = await prisma.employee.findMany({
      where: { organizationId: o.id },
      select: { userId: true },
    });
    await cleanup(
      o.id,
      emps.map((e) => e.userId).filter(Boolean) as string[]
    );
  }

  const passwordHash = await hashPassword("TestPass123!");
  const user = await prisma.user.create({
    data: {
      email: `att.self.${Date.now()}@test.local`,
      name: "Self Att User",
      passwordHash,
      isActive: true,
    },
  });
  const org = await prisma.organization.create({
    data: { code: "ATT_SELF_T", name: "Att Self Tenant", defaultLocale: "en" },
  });

  try {
    try {
      await attendance.myAttendance(org.id, user.id);
      fail("Unlinked user GET me → 404", "expected throw");
    } catch (err) {
      if (
        err instanceof AppError &&
        err.statusCode === 404 &&
        err.message === "No employee profile is linked to this account"
      ) {
        pass("Unlinked user GET me → 404");
      } else fail("Unlinked user GET me → 404", String(err));
    }

    const emp = await prisma.employee.create({
      data: {
        organizationId: org.id,
        employeeNumber: "EMP-ATT-1",
        firstName: "Nour",
        lastName: "Hassan",
        userId: user.id,
      },
    });

    const meEmpty = await attendance.myAttendance(org.id, user.id);
    if (meEmpty.employee?.id === emp.id && meEmpty.today === null) {
      pass("GET me returns employee with today null");
    } else fail("GET me returns employee with today null", JSON.stringify(meEmpty));

    const punched = await attendance.myCheckIn(org.id, user.id);
    if (punched.checkInAt && punched.workedMinutes === 0 && !punched.checkOutAt) {
      pass("Self check-in creates record");
    } else fail("Self check-in creates record", JSON.stringify(punched));

    try {
      await attendance.myCheckIn(org.id, user.id);
      fail("Duplicate self check-in → 409", "expected throw");
    } catch (err) {
      if (err instanceof AppError && err.statusCode === 409) pass("Duplicate self check-in → 409");
      else fail("Duplicate self check-in → 409", String(err));
    }

    const outAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
    const closed = await attendance.checkOut(
      org.id,
      { employeeId: emp.id, at: outAt },
      user.id
    );
    if (closed.checkOutAt && closed.workedMinutes > 0) {
      pass("HR check-out with at sets workedMinutes");
    } else fail("HR check-out with at sets workedMinutes", JSON.stringify(closed));

    const meDone = await attendance.myAttendance(org.id, user.id);
    if (meDone.today?.workedMinutes === closed.workedMinutes) {
      pass("GET me reflects completed day");
    } else fail("GET me reflects completed day", JSON.stringify(meDone.today));
  } finally {
    await cleanup(org.id, [user.id]);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
