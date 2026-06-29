import { prisma } from './prisma.js';

interface LogInput {
  userId: string;
  isSystemAdmin?: boolean;
  projectId?: string;
  action: string;        // e.g. 'defect_filed', 'case_created', 'run_started'
  entityType: string;    // e.g. 'defect', 'test_case', 'run', 'plan', 'member'
  entityId?: string;
  entityName?: string;
}

export async function logActivity(input: LogInput): Promise<void> {
  if (input.isSystemAdmin) return; // sys admin actions are not logged

  try {
    const [user, project] = await Promise.all([
      prisma.user.findUnique({
        where: { id: input.userId },
        select: { name: true, email: true },
      }),
      input.projectId
        ? prisma.project.findUnique({
            where: { id: input.projectId },
            select: { name: true },
          })
        : Promise.resolve(null),
    ]);

    if (!user) return;

    await prisma.activityLog.create({
      data: {
        userId:      input.userId,
        userName:    user.name,
        userEmail:   user.email,
        projectId:   input.projectId ?? null,
        projectName: project?.name ?? null,
        action:      input.action,
        entityType:  input.entityType,
        entityId:    input.entityId ?? null,
        entityName:  input.entityName ?? null,
      },
    });
  } catch {
    // logging must never interrupt the main request flow
  }
}
