import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUserId } from "@/lib/getSessionUserId";

export async function GET(req: NextRequest) {
  try {
    const userId = await getSessionUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const projects = await db.project.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        description: true,
        createdAt: true,
        updatedAt: true,
      }
    });

    return NextResponse.json(projects);
  } catch (error: any) {
    console.error('[GET /api/projects] Error:', error);
    return NextResponse.json(
      { error: error.message || "Failed to load projects" }, 
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getSessionUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: { name?: string; description?: string } = {};
    try {
      const text = await req.text();
      if (text) {
        body = JSON.parse(text);
      }
    } catch (e) {
      // Empty or invalid JSON - use defaults
    }

    let projectName = body.name || `Project ${new Date().toISOString().split('T')[0]}`;
    let attempt = 0;
    const maxAttempts = 10;
    
    while (attempt < maxAttempts) {
      try {
        console.log('[POST /api/projects] userId:', userId);
        const userExists = await db.user.findUnique({ where: { id: userId } });
        console.log('[POST /api/projects] user exists:', !!userExists);
        if (!userExists) {
          return NextResponse.json(
            { error: `User ${userId} not found in database` },
            { status: 400 }
          );
        }

        const project = await db.project.create({
          data: {
            name: attempt === 0 ? projectName : `${projectName} (${attempt})`,
            description: body.description || null,
            userId: userId,
          },
        });
        
        return NextResponse.json(project);
      } catch (error: any) {
        if (error.code === 'P2002' && attempt < maxAttempts - 1) {
          attempt++;
          continue;
        }
        throw error;
      }
    }
    
    throw new Error("Could not generate unique project name");
    
  } catch (error: any) {
    console.error('[POST /api/projects] Error:', error);
    
    if (error.code === 'P2002') {
      return NextResponse.json(
        { error: "A project with this name already exists" }, 
        { status: 409 }
      );
    }
    
    return NextResponse.json(
      { error: error.message || "Failed to create project" }, 
      { status: 500 }
    );
  }
}
