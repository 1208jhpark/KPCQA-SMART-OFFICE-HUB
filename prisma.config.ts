import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // 뒤에 !를 붙여서 "무조건 값이 있다"고 타입스크립트에게 알려줍니다.
    url: process.env["DATABASE_URL"]!, 
  },
});