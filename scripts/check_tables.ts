import { PrismaClient } from '@prisma/client';

async function main(){
  const prisma = new PrismaClient();
  try{
    const rows = await prisma.$queryRaw`SELECT table_name FROM information_schema.tables WHERE table_schema='public';`;
    console.log(JSON.stringify(rows, null, 2));
  }catch(e){
    console.error(e);
    process.exit(1);
  }finally{
    await new PrismaClient().$disconnect();
  }
}
main();
