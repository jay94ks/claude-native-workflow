import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";

const prisma = new PrismaClient();

async function main() {
  let admin = await prisma.account.findUnique({ where: { username: "admin" } });
  if (admin) {
    console.log("bootstrap admin account already exists, skipping account creation");
  } else {
    const passwordHash = await argon2.hash("12345678");
    admin = await prisma.account.create({ data: { username: "admin", passwordHash } });
    console.log('created bootstrap account "admin" (password: 12345678 - change it after first login)');
  }

  const demoProject = await prisma.project.upsert({
    where: { id: "demo-project" },
    update: {},
    create: { id: "demo-project", name: "Demo Project" },
  });
  await prisma.projectMembership.upsert({
    where: { projectId_accountId: { projectId: demoProject.id, accountId: admin.id } },
    update: { role: "ADMIN" },
    create: { projectId: demoProject.id, accountId: admin.id, role: "ADMIN" },
  });
  console.log(`ensured demo project "${demoProject.id}" with admin as its sole Admin (for scaffold verification)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
