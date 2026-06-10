import { prisma } from "../lib/prisma.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function asUuidOrNull(value?: string | null): string | null {
  if (!value) return null;
  return UUID_RE.test(value) ? value : null;
}

function mergeValues(
  base: unknown,
  extra: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (base && typeof base === "object" && !Array.isArray(base)) {
    return { ...(base as Record<string, unknown>), ...extra };
  }
  if (Object.keys(extra).length === 0) return base as Record<string, unknown> | undefined;
  return { ...(base !== undefined ? { value: base } : {}), ...extra };
}

export async function writeAuditLog(params: {
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  oldValues?: unknown;
  newValues?: unknown;
}) {
  const userId = asUuidOrNull(params.userId);
  const entityId = asUuidOrNull(params.entityId);

  const newValues =
    params.entityId && !entityId
      ? mergeValues(params.newValues, { entity_key: params.entityId })
      : params.newValues;

  await prisma.auditLog.create({
    data: {
      userId,
      action: params.action,
      entityType: params.entityType,
      entityId,
      oldValues: params.oldValues ?? undefined,
      newValues: newValues ?? undefined,
    },
  });
}
