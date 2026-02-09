import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { prisma } from "@/lib/prisma";
import { randomUUID } from "crypto";

type ProductRow = {
  id: string;
  name: string;
  productProblemSolved: string | null;
  amazonAsin: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const CreateProductSchema = z.object({
  name: z.string().trim().min(1, "Product name is required").max(200),
  productProblemSolved: z.string().trim().max(500).optional(),
  amazonAsin: z.string().trim().max(64).optional(),
});

async function assertProjectOwner(projectId: string, userId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
    select: { id: true },
  });
  return Boolean(project);
}

async function ensureProductsTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "product" (
      "id" text PRIMARY KEY,
      "project_id" text NOT NULL REFERENCES "project"("id") ON DELETE CASCADE,
      "name" text NOT NULL,
      "product_problem_solved" text,
      "amazon_asin" text,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "product_project_name_unique" UNIQUE ("project_id", "name")
    );
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "product_project_id_idx" ON "product" ("project_id");`
  );
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const projectId = params.projectId;
    const ownsProject = await assertProjectOwner(projectId, userId);
    if (!ownsProject) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await ensureProductsTable();
    const products = await prisma.$queryRaw<ProductRow[]>`
      SELECT
        "id",
        "name",
        "product_problem_solved" AS "productProblemSolved",
        "amazon_asin" AS "amazonAsin",
        "created_at" AS "createdAt",
        "updated_at" AS "updatedAt"
      FROM "product"
      WHERE "project_id" = ${projectId}
      ORDER BY "created_at" DESC
    `;

    return NextResponse.json({ success: true, products }, { status: 200 });
  } catch (error) {
    console.error("Failed to fetch products", error);
    return NextResponse.json({ error: "Failed to fetch products" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const projectId = params.projectId;
    const ownsProject = await assertProjectOwner(projectId, userId);
    if (!ownsProject) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const parsed = CreateProductSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const data = parsed.data;
    await ensureProductsTable();
    const existing = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "product"
      WHERE "project_id" = ${projectId}
        AND "name" = ${data.name}
      LIMIT 1
    `;
    if (existing.length > 0) {
      return NextResponse.json(
        { error: "A product with this name already exists in this project." },
        { status: 409 }
      );
    }

    const id = randomUUID();
    const inserted = await prisma.$queryRaw<ProductRow[]>`
      INSERT INTO "product" (
        "id",
        "project_id",
        "name",
        "product_problem_solved",
        "amazon_asin"
      )
      VALUES (
        ${id},
        ${projectId},
        ${data.name},
        ${data.productProblemSolved || null},
        ${data.amazonAsin || null}
      )
      RETURNING
        "id",
        "name",
        "product_problem_solved" AS "productProblemSolved",
        "amazon_asin" AS "amazonAsin",
        "created_at" AS "createdAt",
        "updated_at" AS "updatedAt"
    `;
    const product = inserted[0];

    return NextResponse.json({ success: true, product }, { status: 201 });
  } catch (error: any) {
    console.error("Failed to create product", error);
    return NextResponse.json({ error: "Failed to create product" }, { status: 500 });
  }
}
