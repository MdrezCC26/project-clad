import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { getAppProxyContext } from "../utils/appProxy.server";
import { publishShapeLibraryEntry } from "../utils/shapeLibrary.server";
import type { ShapeLeg } from "../utils/shapeProfile";
import { requireShapeCalculatorEnabled } from "../utils/shapeFeature";

function asLegs(value: unknown): ShapeLeg[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const angle = Number((row as { angle?: unknown }).angle);
    const length = Number((row as { length?: unknown }).length);
    if (!Number.isFinite(angle) || !Number.isFinite(length) || length <= 0) {
      return [];
    }
    return [{ angle, length }];
  });
}

export const action = async ({ request }: ActionFunctionArgs) => {
  requireShapeCalculatorEnabled();
  const { shop } = getAppProxyContext(request);
  const body = (await request.json().catch(() => null)) as {
    segments?: unknown;
    gauge?: unknown;
    color?: unknown;
    girth?: unknown;
  } | null;
  const legs = asLegs(body?.segments);
  if (!legs.length) {
    return Response.json({ error: "Missing profile segments." }, { status: 400 });
  }
  const entry = await publishShapeLibraryEntry({
    shop,
    legs,
    gauge: typeof body?.gauge === "string" ? body.gauge : null,
    color: typeof body?.color === "string" ? body.color : null,
    girth: typeof body?.girth === "number" ? body.girth : undefined,
  });
  return Response.json({ ok: true, id: entry?.id ?? null });
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  requireShapeCalculatorEnabled();
  getAppProxyContext(request);
  return Response.json({ ok: true });
};
