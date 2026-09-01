import type { ActionFunctionArgs } from "react-router";
import { requireAppProxyCustomer } from "../utils/appProxy.server";
import {
  addShapeCartItem,
  clearShapeCart,
  countShapeCart,
  listShapeCart,
  removeShapeCartItem,
  setShapeCartQuantity,
  ShapeCartError,
} from "../utils/shapeCart.server";
import { buildShapeOrderItems } from "../utils/shapeVariant.server";
import { requireShapeCalculatorEnabled } from "../utils/shapeFeature";

const SHAPE_CART_PATH = "/apps/project-clad/shape-cart";

type ShapeCartRequest = {
  action?: string;
  id?: string;
  quantity?: number;
  legs?: unknown;
  gauge?: string;
  color?: string;
  lengthIn?: number;
  bends?: number;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  requireShapeCalculatorEnabled();
  const { shop, customerId } = requireAppProxyCustomer(request, {
    jsonOnFail: true,
  });

  let payload: ShapeCartRequest;
  try {
    payload = (await request.json()) as ShapeCartRequest;
  } catch {
    return Response.json({ error: "Invalid cart request." }, { status: 400 });
  }

  try {
    switch (payload.action) {
      case "add": {
        const line = await addShapeCartItem({
          shop,
          customerId,
          legs: payload.legs,
          gauge: payload.gauge,
          color: payload.color,
          lengthIn: payload.lengthIn,
          bends: payload.bends,
          quantity: payload.quantity,
        });
        return Response.json({
          ok: true,
          line,
          itemCount: await countShapeCart(shop, customerId),
          cartUrl: SHAPE_CART_PATH,
        });
      }
      case "qty": {
        if (!payload.id) {
          return Response.json({ error: "Missing item." }, { status: 400 });
        }
        await setShapeCartQuantity({
          shop,
          customerId,
          id: payload.id,
          quantity: Number(payload.quantity),
        });
        break;
      }
      case "remove": {
        if (!payload.id) {
          return Response.json({ error: "Missing item." }, { status: 400 });
        }
        await removeShapeCartItem({ shop, customerId, id: payload.id });
        break;
      }
      case "clear": {
        await clearShapeCart(shop, customerId);
        break;
      }
      case "save-items": {
        /* Mints one Shopify product+variant per distinct profile, so this is only called when the
           customer commits to saving — never on page view. */
        const cart = await listShapeCart(shop, customerId);
        if (!cart.lines.length) {
          return Response.json(
            { error: "Your custom parts cart is empty." },
            { status: 400 },
          );
        }
        return Response.json({
          ok: true,
          items: await buildShapeOrderItems(shop, cart.lines),
        });
      }
      default:
        return Response.json({ error: "Unsupported action." }, { status: 400 });
    }
  } catch (e) {
    if (e instanceof ShapeCartError) {
      return Response.json({ error: e.message }, { status: 422 });
    }
    console.error("[shape-cart] failed:", e);
    return Response.json(
      { error: "Could not update your cart. Please try again." },
      { status: 500 },
    );
  }

  return Response.json({
    ok: true,
    itemCount: await countShapeCart(shop, customerId),
    cartUrl: SHAPE_CART_PATH,
  });
};
