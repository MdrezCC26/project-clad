export const hasTag = (tags: string[] | undefined, needle: string) =>
  (tags ?? []).some((t) => String(t).trim().toUpperCase() === needle.toUpperCase());

export const hasAdminTag = (tags: string[] | undefined) => hasTag(tags, "ADMIN");
