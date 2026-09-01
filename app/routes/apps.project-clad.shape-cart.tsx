import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import prisma from "../db.server";
import { requireAppProxyCustomer } from "../utils/appProxy.server";
import { viewerHasAdminTag } from "../utils/customerTags.server";
import { projectsListWhere } from "../utils/projectAccess.server";
import { loadShapeStorefrontChrome } from "../utils/shapeStorefrontPage.server";
import { projectCladScriptSrc } from "../utils/projectCladProxyScripts.server";
import { listShapeCart } from "../utils/shapeCart.server";
import {
  formatLength,
  profileToSvg,
  shapeBuilderPath,
} from "../utils/shapeProfile";
import { ShapeStorefrontShell } from "../components/ShapeStorefrontShell";

const money = (amount: number) =>
  `$${amount.toLocaleString("en-CA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, customerId, customerEmail } = requireAppProxyCustomer(request);
  const viewerIsAppAdmin = await viewerHasAdminTag(shop, customerId, customerEmail);
  const [chrome, cart, projects] = await Promise.all([
    loadShapeStorefrontChrome({ request, shop, customerId, customerEmail }),
    listShapeCart(shop, customerId),
    prisma.project.findMany({
      where: projectsListWhere(shop, customerId, viewerIsAppAdmin),
      include: { jobs: { include: { orderLink: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return {
    ...chrome,
    cart,
    scriptSrc: projectCladScriptSrc(request, "shape-cart.js"),
    savePayload: {
      cartApiUrl: "/apps/project-clad/api/shape-cart",
      saveJobUrl: "/apps/project-clad/api/save-job",
    },
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      poNumber: project.poNumber ?? "",
      companyName: project.companyName ?? "",
      jobs: project.jobs
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((job) => ({
          id: job.id,
          name: job.name,
          locked: job.isLocked || Boolean(job.orderLink),
        })),
    })),
  };
};

export default function ShapeCartPage() {
  const data = useLoaderData<typeof loader>();
  const { lines, subtotal, itemCount } = data.cart;

  return (
    <ShapeStorefrontShell
      active="cart"
      title="Custom parts cart"
      subtitle="Stage as many profiles as you need, then send them all to checkout or into a project in one step."
      proxyStylesHref={data.proxyStylesHref}
      themeStyles={data.themeStyles}
      storefrontAppNav={data.storefrontAppNav}
      logoUrl={data.logoUrl}
      backgroundLogoUrl={data.backgroundLogoUrl}
      navAccountInitial={data.navAccountInitial}
      navAccountFirstName={data.navAccountFirstName}
      shapeCartCount={data.shapeCartCount}
      extraScripts={
        <>
          <script
            type="application/json"
            id="pc-shape-cart-payload"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify(data.savePayload).replace(/</g, "\\u003c"),
            }}
          />
          <script src={data.scriptSrc} defer />
        </>
      }
    >
      {lines.length === 0 ? (
        <p className="pc-cart-empty">
          Your custom parts cart is empty.{" "}
          <a href="/apps/project-clad/shape-builder">Build a profile</a> or start
          from a <a href="/apps/project-clad/shape-templates">template</a>.
        </p>
      ) : (
        <div className="pc-cart" data-pc-shape-cart="1">
          <ul className="pc-cart-list">
            {lines.map((line) => (
              <li
                className="pc-cart-line"
                key={line.id}
                data-pc-cart-line={line.id}
              >
                <div
                  className="pc-cart-line__art"
                  dangerouslySetInnerHTML={{
                    __html: profileToSvg(line.legs, 160),
                  }}
                />
                <div className="pc-cart-line__body">
                  <h2 className="pc-cart-line__title">
                    {formatLength(line.girth)}&quot; girth custom profile
                  </h2>
                  <p className="pc-cart-line__meta">
                    {line.gauge} gauge · {line.color} · {line.bends} bend
                    {line.bends === 1 ? "" : "s"} · {formatLength(line.lengthIn)}
                    &quot; long
                  </p>
                  <p className="pc-cart-line__legs">
                    {line.legs
                      .map((leg, i) => `L${i + 1} ${formatLength(leg.length)}"`)
                      .join(" · ")}
                  </p>
                  <div className="pc-cart-line__links">
                    <a
                      href={shapeBuilderPath({
                        legs: line.legs,
                        gauge: line.gauge,
                        color: line.color,
                      })}
                    >
                      Edit a copy
                    </a>
                    <button type="button" data-pc-cart-remove={line.id}>
                      Remove
                    </button>
                  </div>
                </div>
                <div className="pc-cart-line__qty">
                  <button
                    type="button"
                    data-pc-cart-step="-1"
                    aria-label="Decrease quantity"
                  >
                    −
                  </button>
                  <input
                    type="text"
                    inputMode="numeric"
                    defaultValue={line.quantity}
                    aria-label="Quantity"
                    data-pc-cart-qty="1"
                  />
                  <button
                    type="button"
                    data-pc-cart-step="1"
                    aria-label="Increase quantity"
                  >
                    +
                  </button>
                </div>
                <div className="pc-cart-line__money">
                  <span className="pc-cart-line__total">
                    {money(line.lineTotal)}
                  </span>
                  <span className="pc-cart-line__unit">
                    {money(line.unitPrice)} each
                  </span>
                </div>
              </li>
            ))}
          </ul>

          <aside className="pc-cart-summary">
            <div className="pc-cart-summary__row">
              <span>
                Subtotal · {itemCount} part{itemCount === 1 ? "" : "s"}
              </span>
              <strong>{money(subtotal)}</strong>
            </div>
            <p className="pc-cart-summary__note">
              Prices come from the gauge rate × girth × length, plus $2.50 per
              bend. Delivery and taxes are added when the order is placed.
            </p>
            <button
              type="button"
              className="pc-cart-btn pc-cart-btn--primary"
              data-pc-cart-save-open="1"
            >
              Save to a project
            </button>
            <button type="button" className="pc-cart-btn pc-cart-btn--quiet" data-pc-cart-clear="1">
              Empty this cart
            </button>
          </aside>

          <section className="pc-cart-save" data-pc-cart-save-panel="1" hidden>
            <h2 className="pc-cart-save__title">Save to a project</h2>
            <div className="pc-cart-save__grid">
              <label className="pc-cart-field">
                <span>Destination</span>
                <select data-pc-save-mode="1">
                  <option value="newProject">New project</option>
                  <option value="existingProject">
                    New order in an existing project
                  </option>
                  <option value="existingJob">Add to an existing order</option>
                </select>
              </label>
              <label className="pc-cart-field" data-pc-save-field="project" hidden>
                <span>Project</span>
                <select data-pc-save-project="1">
                  <option value="">Select a project</option>
                  {data.projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="pc-cart-field" data-pc-save-field="job" hidden>
                <span>Order</span>
                <select data-pc-save-job="1">
                  <option value="">Select an order</option>
                  {data.projects.flatMap((project) =>
                    project.jobs.map((job) => (
                      <option
                        key={job.id}
                        value={job.id}
                        data-project={project.id}
                      >
                        {job.name}
                        {job.locked ? " (locked — saves as a copy)" : ""}
                      </option>
                    )),
                  )}
                </select>
              </label>
              <label
                className="pc-cart-field"
                data-pc-save-field="projectName"
              >
                <span>Project name</span>
                <input type="text" data-pc-save-project-name="1" />
              </label>
              <label className="pc-cart-field" data-pc-save-field="jobName">
                <span>Order name</span>
                <input
                  type="text"
                  defaultValue="Custom parts"
                  data-pc-save-job-name="1"
                />
              </label>
              <label className="pc-cart-field">
                <span>PO number (optional)</span>
                <input type="text" data-pc-save-po="1" />
              </label>
              <label className="pc-cart-field">
                <span>Company (optional)</span>
                <input type="text" data-pc-save-company="1" />
              </label>
            </div>
            <p className="pc-cart-save__status" data-pc-save-status="1" role="status" />
            <div className="pc-cart-save__actions">
              <button
                type="button"
                className="pc-cart-btn pc-cart-btn--primary"
                data-pc-save-submit="1"
              >
                Save to project
              </button>
              <button
                type="button"
                className="pc-cart-btn pc-cart-btn--quiet"
                data-pc-save-cancel="1"
              >
                Cancel
              </button>
            </div>
          </section>
        </div>
      )}
    </ShapeStorefrontShell>
  );
}
