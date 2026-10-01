import crypto from "node:crypto";
import { Prisma, type QuoteRequestMode } from "@prisma/client";

export const QUOTE_GAUGES = ["16 ga", "18 ga", "20 ga", "22 ga", "24 ga", "26 ga"] as const;
export const QUOTE_FULFILLMENT = ["Pickup", "Delivery", "Not sure yet"] as const;

export const QUOTE_MAX_FILE_BYTES = 20 * 1024 * 1024;
export const QUOTE_MAX_FILES = 25;
/** Whole request is buffered in memory and stored in Postgres, so cap the sum too. */
export const QUOTE_MAX_TOTAL_FILE_BYTES = 60 * 1024 * 1024;
export const QUOTE_MAX_PARTS = 50;
export const QUOTE_MAX_COLOURS = 20;

const ALLOWED_FILE_EXT = /\.(pdf|dxf|dwg|heic|heif|jpe?g|png|gif|webp|tiff?|bmp)$/i;
const ALLOWED_FILE_TYPE = /^(image\/|application\/pdf$|application\/x-pdf$|application\/dxf$|image\/vnd\.dxf$|application\/acad$|image\/vnd\.dwg$)/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type QuoteFieldErrors = Record<string, string>;

export type QuoteFile = {
  name: string;
  size: number;
  contentType: string;
  buffer: Buffer;
};

export type QuoteLineInput = {
  description: string;
  quantity: number;
  length: string | null;
  gauge: string | null;
  colour: string | null;
  notes: string | null;
  useOrderDrawings: boolean;
  files: QuoteFile[];
};

export type QuoteRequestInput = {
  mode: QuoteRequestMode;
  contactName: string;
  company: string | null;
  email: string;
  phone: string;
  projectName: string | null;
  siteAddress: string | null;
  siteCity: string | null;
  siteProvince: string | null;
  sitePostal: string | null;
  neededBy: Date | null;
  fulfillment: string | null;
  gauge: string | null;
  colours: string[];
  notes: string | null;
  siteNotes: string | null;
  drawings: QuoteFile[];
  documents: QuoteFile[];
  lineItems: QuoteLineInput[];
};

export type QuoteParseResult =
  | { ok: true; value: QuoteRequestInput }
  | { ok: false; error: string; fieldErrors: QuoteFieldErrors };

function text(formData: FormData, key: string, max: number): string {
  const raw = formData.get(key);
  return typeof raw === "string" ? raw.trim().slice(0, max) : "";
}

const orNull = (value: string): string | null => (value ? value : null);

/** Multipart entries are Node File/Blob — not always `instanceof File`. */
async function readFiles(formData: FormData, key: string): Promise<QuoteFile[]> {
  const out: QuoteFile[] = [];
  for (const entry of formData.getAll(key)) {
    if (!entry || typeof entry !== "object") continue;
    const fileLike = entry as {
      size?: number;
      name?: string;
      type?: string;
      arrayBuffer?: () => Promise<ArrayBuffer>;
    };
    if (typeof fileLike.arrayBuffer !== "function") continue;
    const size = typeof fileLike.size === "number" ? fileLike.size : 0;
    if (size <= 0) continue;
    out.push({
      name: (typeof fileLike.name === "string" && fileLike.name.trim()) || "upload",
      size,
      contentType: typeof fileLike.type === "string" ? fileLike.type : "",
      buffer: Buffer.from(await fileLike.arrayBuffer()),
    });
  }
  return out;
}

export function quoteFileProblem(file: QuoteFile): string | null {
  if (file.size > QUOTE_MAX_FILE_BYTES || file.buffer.length > QUOTE_MAX_FILE_BYTES) {
    return `${file.name} is over ${QUOTE_MAX_FILE_BYTES / 1024 / 1024}MB`;
  }
  if (!ALLOWED_FILE_EXT.test(file.name) && !ALLOWED_FILE_TYPE.test(file.contentType)) {
    return `${file.name} is not a photo, PDF, DXF or DWG`;
  }
  return null;
}

function gaugeValue(raw: string): string | null | undefined {
  if (!raw) return null;
  return (QUOTE_GAUGES as readonly string[]).includes(raw) ? raw : undefined;
}

function parseColours(formData: FormData): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of formData.getAll("colours[]")) {
    if (typeof raw !== "string") continue;
    const value = raw.trim().slice(0, 60);
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= QUOTE_MAX_COLOURS) break;
  }
  return out;
}

export async function parseQuoteRequestForm(formData: FormData): Promise<QuoteParseResult> {
  const fieldErrors: QuoteFieldErrors = {};
  const flag = (field: string, message: string) => {
    if (!fieldErrors[field]) fieldErrors[field] = message;
  };

  const contactName = text(formData, "contact_name", 200);
  const email = text(formData, "email", 254);
  const phone = text(formData, "phone", 50);
  if (!contactName) flag("contact_name", "Enter your name");
  if (!email) flag("email", "Enter an email address");
  else if (!EMAIL_RE.test(email)) flag("email", "That email address does not look right");
  if (!phone) flag("phone", "Enter a phone number");

  const modeRaw = text(formData, "mode", 20);
  const mode: QuoteRequestMode | null =
    modeRaw === "DRAWINGS" || modeRaw === "ITEMIZED" ? modeRaw : null;
  if (!mode) flag("mode", "Choose how you want to send your parts");

  const neededByRaw = text(formData, "needed_by", 10);
  let neededBy: Date | null = null;
  if (neededByRaw) {
    const parsed = DATE_RE.test(neededByRaw) ? new Date(`${neededByRaw}T00:00:00Z`) : null;
    if (parsed && !Number.isNaN(parsed.getTime())) neededBy = parsed;
    else flag("needed_by", "Enter a valid date");
  }

  const fulfillmentRaw = text(formData, "fulfillment", 40);
  const fulfillment = (QUOTE_FULFILLMENT as readonly string[]).includes(fulfillmentRaw)
    ? fulfillmentRaw
    : null;

  const gauge = gaugeValue(text(formData, "order_gauge", 20));
  if (gauge === undefined) flag("order_gauge", "Choose a gauge from the list");

  const colours = parseColours(formData);
  const notes = orNull(text(formData, "parts_notes", 5000));
  const siteNotes = orNull(text(formData, "notes", 5000));

  const drawings = await readFiles(formData, "drawings[]");
  const documents = await readFiles(formData, "documents[]");

  const partCountRaw = Number(text(formData, "part_count", 6));
  const partCount =
    Number.isSafeInteger(partCountRaw) && partCountRaw > 0
      ? Math.min(partCountRaw, QUOTE_MAX_PARTS)
      : 0;

  const lineItems: QuoteLineInput[] = [];
  for (let i = 0; i < partCount; i++) {
    const key = (field: string) => `parts[${i}][${field}]`;
    const description = text(formData, key("description"), 500);
    const quantityRaw = text(formData, key("quantity"), 10);
    const quantity = Number(quantityRaw);
    if (!description) flag(key("description"), "Describe the profile");
    if (!quantityRaw || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100000) {
      flag(key("quantity"), "Quantity must be at least 1");
    }
    const partGauge = gaugeValue(text(formData, key("gauge"), 20));
    if (partGauge === undefined) flag(key("gauge"), "Choose a gauge from the list");

    const files = await readFiles(formData, `${key("files")}[]`);
    const wantsOwnFiles = text(formData, key("drawing_source"), 10) === "own";

    lineItems.push({
      description,
      quantity: Number.isSafeInteger(quantity) ? quantity : 0,
      length: orNull(text(formData, key("length"), 60)),
      gauge: partGauge ?? null,
      colour: orNull(text(formData, key("colour"), 60)),
      notes: orNull(text(formData, key("notes"), 2000)),
      useOrderDrawings: !(wantsOwnFiles && files.length > 0),
      files: wantsOwnFiles ? files : [],
    });
  }

  if (mode === "ITEMIZED" && lineItems.length === 0) {
    flag("parts", "Add at least one part");
  }
  if (mode === "DRAWINGS" && drawings.length === 0 && !notes) {
    flag("drawings", "Upload a drawing or fill in Notes");
  }

  const fileGroups: Array<[string, QuoteFile[]]> = [
    ["drawings", drawings],
    ["documents", documents],
    ...lineItems.map((line, i): [string, QuoteFile[]] => [`parts[${i}][files]`, line.files]),
  ];
  let fileCount = 0;
  let fileBytes = 0;
  for (const [field, files] of fileGroups) {
    for (const file of files) {
      fileCount += 1;
      fileBytes += file.size;
      const problem = quoteFileProblem(file);
      if (problem) flag(field, problem);
    }
  }
  if (fileCount > QUOTE_MAX_FILES) {
    flag("drawings", `Limit of ${QUOTE_MAX_FILES} files reached`);
  } else if (fileBytes > QUOTE_MAX_TOTAL_FILE_BYTES) {
    flag(
      "drawings",
      `Attachments total more than ${QUOTE_MAX_TOTAL_FILE_BYTES / 1024 / 1024}MB. Email large drawing sets instead.`,
    );
  }

  if (Object.keys(fieldErrors).length || !mode) {
    return { ok: false, error: "Please check the highlighted fields.", fieldErrors };
  }

  return {
    ok: true,
    value: {
      mode,
      contactName,
      company: orNull(text(formData, "company", 200)),
      email,
      phone,
      projectName: orNull(text(formData, "project_name", 200)),
      siteAddress: orNull(text(formData, "site_address", 300)),
      siteCity: orNull(text(formData, "site_city", 120)),
      siteProvince: orNull(text(formData, "site_province", 40)),
      sitePostal: orNull(text(formData, "site_postal", 20)),
      neededBy,
      fulfillment,
      gauge: gauge ?? null,
      colours,
      notes,
      siteNotes,
      drawings,
      documents,
      lineItems,
    },
  };
}

const REFERENCE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function generateQuoteReference(): string {
  let out = "Q-";
  for (let i = 0; i < 6; i++) {
    out += REFERENCE_ALPHABET[crypto.randomInt(REFERENCE_ALPHABET.length)];
  }
  return out;
}

const fileRow = (file: QuoteFile) => ({
  fileName: file.name.slice(0, 255),
  contentType: file.contentType.slice(0, 120) || "application/octet-stream",
  size: file.size,
  data: new Uint8Array(file.buffer),
});

export async function createQuoteRequest(args: {
  shop: string;
  customerId?: string;
  input: QuoteRequestInput;
}): Promise<{ id: string; reference: string }> {
  const { default: prisma } = await import("../db.server");
  const { shop, customerId, input } = args;

  for (let attempt = 0; ; attempt++) {
    const reference = generateQuoteReference();
    try {
      return await prisma.$transaction(
        async (tx) => {
          const request = await tx.quoteRequest.create({
            data: {
              reference,
              shop,
              customerId: customerId ?? null,
              mode: input.mode,
              contactName: input.contactName,
              company: input.company,
              email: input.email,
              phone: input.phone,
              projectName: input.projectName,
              siteAddress: input.siteAddress,
              siteCity: input.siteCity,
              siteProvince: input.siteProvince,
              sitePostal: input.sitePostal,
              neededBy: input.neededBy,
              fulfillment: input.fulfillment,
              gauge: input.gauge,
              colours: input.colours,
              notes: input.notes,
              siteNotes: input.siteNotes,
              files: {
                create: [
                  ...input.drawings.map((f) => ({ kind: "DRAWING" as const, ...fileRow(f) })),
                  ...input.documents.map((f) => ({ kind: "DOCUMENT" as const, ...fileRow(f) })),
                ],
              },
            },
            select: { id: true, reference: true },
          });

          for (const [sortOrder, line] of input.lineItems.entries()) {
            await tx.quoteRequestLineItem.create({
              data: {
                quoteRequestId: request.id,
                sortOrder,
                description: line.description,
                quantity: line.quantity,
                length: line.length,
                gauge: line.gauge,
                colour: line.colour,
                notes: line.notes,
                useOrderDrawings: line.useOrderDrawings,
                files: {
                  create: line.files.map((f) => ({
                    quoteRequestId: request.id,
                    kind: "LINE_ITEM" as const,
                    ...fileRow(f),
                  })),
                },
              },
            });
          }

          return request;
        },
        { timeout: 30_000 },
      );
    } catch (error) {
      const referenceTaken =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
      if (!referenceTaken || attempt >= 2) throw error;
    }
  }
}
