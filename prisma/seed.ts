/**
 * Idempotent seed for Halevora Tasks.
 *
 * Creates one workspace ("Halevora") with a "Halevora" project, the team roster
 * (Noel Pollak = CEO, plus placeholder members to rename later), a few boards that
 * mirror Noel's ClickUp screenshots, and a spread of tasks across statuses/priorities
 * so the board view has content from the first run.
 *
 * Safe to re-run: every entity is upserted on a stable natural key.
 */
import { PrismaClient, Priority, Status } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// Dev password for every seeded account. Section 2 wires the real login flow.
const DEV_PASSWORD = "halevora";

async function main() {
  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 10);

  // --- Users -------------------------------------------------------------
  const noel = await prisma.user.upsert({
    where: { email: "noel@halevora.com" },
    update: { name: "Noel Pollak", role: "CEO" },
    create: {
      email: "noel@halevora.com",
      name: "Noel Pollak",
      role: "CEO",
      passwordHash,
      timezone: "Asia/Jerusalem",
    },
  });

  const memberSeeds = [
    { email: "member1@halevora.com", name: "Team Member 1" },
    { email: "member2@halevora.com", name: "Team Member 2" },
    { email: "member3@halevora.com", name: "Team Member 3" },
  ];
  const members = [];
  for (const m of memberSeeds) {
    const u = await prisma.user.upsert({
      where: { email: m.email },
      update: { name: m.name },
      create: { email: m.email, name: m.name, role: "MEMBER", passwordHash },
    });
    members.push(u);
  }

  // --- Workspace / Project ----------------------------------------------
  // Workspace/Project lack a natural unique key, so look up by name then create.
  let workspace = await prisma.workspace.findFirst({ where: { name: "Halevora" } });
  if (!workspace) {
    workspace = await prisma.workspace.create({ data: { name: "Halevora" } });
  }

  let project = await prisma.project.findFirst({
    where: { name: "Halevora", workspaceId: workspace.id },
  });
  if (!project) {
    project = await prisma.project.create({
      data: { name: "Halevora", workspaceId: workspace.id, order: 0 },
    });
  }

  // --- Boards (ClickUp Lists) -------------------------------------------
  const boardSeeds = [
    { name: "Innovations", color: "#7C5CFF", order: 0 },
    { name: "Client Success", color: "#22C55E", order: 1 },
    { name: "Meta Ads", color: "#F59E0B", order: 2 },
  ];
  const boards: Record<string, { id: string }> = {};
  for (const b of boardSeeds) {
    let board = await prisma.board.findFirst({
      where: { name: b.name, projectId: project.id },
    });
    if (!board) {
      board = await prisma.board.create({
        data: { name: b.name, color: b.color, order: b.order, projectId: project.id },
      });
    }
    boards[b.name] = board;
  }

  // --- Tags --------------------------------------------------------------
  const tagSeeds = [
    { name: "design", color: "#7C5CFF" },
    { name: "urgent", color: "#EF4444" },
    { name: "research", color: "#3B82F6" },
  ];
  const tags: Record<string, { id: string }> = {};
  for (const t of tagSeeds) {
    tags[t.name] = await prisma.tag.upsert({
      where: { name: t.name },
      update: { color: t.color },
      create: t,
    });
  }

  // --- Tasks -------------------------------------------------------------
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  type TaskSeed = {
    key: string; // stable de-dupe key stored nowhere; we match on (boardId,title)
    board: string;
    title: string;
    status: Status;
    priority: Priority;
    order: number;
    dueOffsetDays?: number; // relative to now
    startOffsetDays?: number;
    assignees?: { id: string }[];
    tags?: string[];
  };

  const taskSeeds: TaskSeed[] = [
    {
      key: "i1",
      board: "Innovations",
      title: "Prototype the new onboarding flow",
      status: "IN_PROGRESS",
      priority: "HIGH",
      order: 0,
      startOffsetDays: -2,
      dueOffsetDays: 3,
      assignees: [noel, members[0]],
      tags: ["design", "research"],
    },
    {
      key: "i2",
      board: "Innovations",
      title: "Research competitor pricing",
      status: "TODO",
      priority: "NORMAL",
      order: 1,
      dueOffsetDays: 7,
      assignees: [members[1]],
      tags: ["research"],
    },
    {
      key: "i3",
      board: "Innovations",
      title: "Ship the dark theme tokens",
      status: "DONE",
      priority: "NORMAL",
      order: 2,
      assignees: [members[0]],
    },
    {
      key: "c1",
      board: "Client Success",
      title: "Follow up with overdue renewal",
      status: "TODO",
      priority: "URGENT",
      order: 0,
      dueOffsetDays: -1, // overdue (derived)
      assignees: [noel],
      tags: ["urgent"],
    },
    {
      key: "c2",
      board: "Client Success",
      title: "Draft Q3 success playbook",
      status: "IN_PROGRESS",
      priority: "NORMAL",
      order: 1,
      dueOffsetDays: 10,
      assignees: [members[2]],
    },
    {
      key: "c3",
      board: "Client Success",
      title: "Archive closed Q1 accounts",
      status: "REVIEWED",
      priority: "LOW",
      order: 2,
      assignees: [members[1]],
    },
    {
      key: "m1",
      board: "Meta Ads",
      title: "Launch summer retargeting campaign",
      status: "IN_PROGRESS",
      priority: "HIGH",
      order: 0,
      startOffsetDays: -1,
      dueOffsetDays: 2,
      assignees: [noel, members[2]],
      tags: ["urgent"],
    },
    {
      key: "m2",
      board: "Meta Ads",
      title: "Refresh creative for top 3 ad sets",
      status: "TODO",
      priority: "NORMAL",
      order: 1,
      dueOffsetDays: 5,
      assignees: [members[0]],
      tags: ["design"],
    },
  ];

  for (const t of taskSeeds) {
    const board = boards[t.board];
    const existing = await prisma.task.findFirst({
      where: { boardId: board.id, title: t.title, parentId: null },
    });
    if (existing) continue; // idempotent: leave user edits alone
    await prisma.task.create({
      data: {
        boardId: board.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        order: t.order,
        createdById: noel.id,
        startAt: t.startOffsetDays != null ? new Date(now + t.startOffsetDays * day) : null,
        dueAt: t.dueOffsetDays != null ? new Date(now + t.dueOffsetDays * day) : null,
        assignees: t.assignees ? { connect: t.assignees.map((a) => ({ id: a.id })) } : undefined,
        tags: t.tags ? { connect: t.tags.map((name) => ({ id: tags[name].id })) } : undefined,
      },
    });
  }

  const taskCount = await prisma.task.count();
  console.log(
    `Seed complete: 1 workspace, 1 project, ${boardSeeds.length} boards, ` +
      `${1 + members.length} users, ${taskCount} tasks.`,
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
