import {MigrationInterface, QueryRunner} from "typeorm";

export class init1639948143366 implements MigrationInterface {
    name = 'init1639948143366'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "subscription" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "status" character varying NOT NULL DEFAULT 'CREATED', "address" character varying NOT NULL, "topic" character varying NOT NULL, CONSTRAINT "PK_8c3e00ebd02103caa1174cd5d9d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_944f71468e89554380d6c0d197" ON "subscription" ("status") `);
        await queryRunner.query(`CREATE INDEX "IDX_986035e37335929dc4e6caa4c0" ON "subscription" ("address") `);
        await queryRunner.query(`CREATE INDEX "IDX_0cfc83592dbf7a0e4fcd12128b" ON "subscription" ("topic") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_0cfc83592dbf7a0e4fcd12128b"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_986035e37335929dc4e6caa4c0"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_944f71468e89554380d6c0d197"`);
        await queryRunner.query(`DROP TABLE "subscription"`);
    }

}
