import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { getAppProxyContext } from "../utils/appProxy.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  let shop: string;
  try {
    shop = getAppProxyContext(request).shop;
  } catch {
    // Dev bypass: allow shop param without proxy signature (for local testing)
    if (process.env.NODE_ENV === "development") {
      const url = new URL(request.url);
      shop = url.searchParams.get("shop") || "";
      if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop)) {
        return Response.json({ error: "Missing or invalid shop param" }, { status: 400 });
      }
    } else {
      throw new Response("Unauthorized", { status: 401 });
    }
  }
  const url = new URL(request.url);
  const shapeType = url.searchParams.get("shapeType") || "";
  const gauge = parseInt(url.searchParams.get("gauge") || "16", 10);
  const L1 = parseFloat(url.searchParams.get("L1") || "0");
  const L2 = parseFloat(url.searchParams.get("L2") || "0");
  const L3 = parseFloat(url.searchParams.get("L3") || "0");
  const quantity = Math.max(1, parseInt(url.searchParams.get("quantity") || "1", 10));

  if (shapeType !== "L" && shapeType !== "Z" && shapeType !== "U") {
    return Response.json({ error: "Invalid shapeType" }, { status: 400 });
  }

  const config = await prisma.gaugeConfig.findUnique({
    where: { shop_gauge: { shop, gauge } },
  });

  if (!config) {
    return Response.json({ error: "Gauge not configured" }, { status: 400 });
  }

  const value = Number(config.value);
  const girth =
    shapeType === "L" ? L1 + L2 : L1 + L2 + L3;
  const lengthFeet = 10; // 120" fixed
  const unitPrice = value * girth * lengthFeet;
  const totalPrice = Math.round(unitPrice * quantity * 100) / 100;

  return Response.json({
    unitPrice: Math.round(unitPrice * 100) / 100,
    totalPrice,
    girth,
    gauge,
    shapeType,
  });
};
