import { execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const run = promisify(execFile);

/**
 * Sequential migration application, against a real disposable PostgreSQL database.
 *
 * The repository ships one migration, so the question "does this runner apply migrations in
 * order, record each exactly once, and stop safely on a bad migration?" cannot be answered by
 * the project's own migration files. This suite answers it with **synthetic** migrations in a
 * temporary folder, driving the real `src/server/db/migrate.ts` runner through
 * `MIGRATIONS_FOLDER`.
 *
 * Nothing here says anything about the project's schema history; it exercises the runner.
 */

const testUrl = process.env.TEST_DATABASE_URL;
const integration = testUrl ? describe : describe.skip;

/** Journal format matches drizzle/generated/meta/_journal.json. */
function writeMigrations(dir: string, migrations: { tag: string; sql: string }[]): void {
  mkdirSync(join(dir, 'meta'), { recursive: true });
  writeFileSync(
    join(dir, 'meta', '_journal.json'),
    JSON.stringify({
      version: '7',
      dialect: 'postgresql',
      entries: migrations.map((migration, idx) => ({
        idx,
        version: '7',
        when: 1792920862994 + idx * 1000,
        tag: migration.tag,
        breakpoints: true
      }))
    })
  );
  for (const migration of migrations) {
    writeFileSync(join(dir, `${migration.tag}.sql`), migration.sql);
  }
}

async function runMigrator(folder: string, databaseUrl: string) {
  const childEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    DATABASE_URL: databaseUrl,
    MIGRATIONS_FOLDER: folder,
    NODE_ENV: 'test',
    LOG_LEVEL: 'info'
  };
  try {
    const { stdout, stderr } = await run(process.execPath, ['--import', 'tsx', 'src/server/db/migrate.ts'], {
      cwd: process.cwd(),
      env: childEnv,
      encoding: 'utf8'
    });
    return { code: 0, output: `${stdout}${stderr}` };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

integration('sequential migration runner', () => {
  const schemaName = `seq_${Date.now().toString(36)}`;
  let admin: pg.Client;
  let databaseName: string;
  let databaseUrl: URL;
  let folder: string;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: testUrl });
    await admin.connect();
    databaseName = `nse_pulse_seq_test_${Date.now().toString(36)}`;
    await admin.query(`CREATE DATABASE ${databaseName}`);
    databaseUrl = new URL(testUrl!);
    databaseUrl.pathname = `/${databaseName}`;
    folder = mkdtempSync(join(tmpdir(), 'nse-migrations-'));
  });

  afterAll(async () => {
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
      await admin.end();
    }
    if (folder) rmSync(folder, { recursive: true, force: true });
  });

  async function query(sql: string, params: unknown[] = []): Promise<pg.QueryResult> {
    const client = new pg.Client({ connectionString: databaseUrl.toString() });
    await client.connect();
    try {
      return await client.query(sql, params);
    } finally {
      await client.end();
    }
  }

  it('applies two migrations in order and records each once', async () => {
    writeMigrations(folder, [
      {
        tag: '0000_first',
        sql: `CREATE SCHEMA ${schemaName};
              CREATE TABLE ${schemaName}.widgets (id serial PRIMARY KEY, name text NOT NULL);`
      },
      {
        tag: '0001_second',
        sql: `ALTER TABLE ${schemaName}.widgets ADD COLUMN colour text;
              INSERT INTO ${schemaName}.widgets (name, colour) VALUES ('sprocket', 'green');`
      }
    ]);

    const first = await runMigrator(folder, databaseUrl.toString());
    expect(first.code, first.output).toBe(0);

    const journal = await query('SELECT count(*)::int AS applied FROM drizzle.__drizzle_migrations');
    expect(journal.rows[0].applied).toBe(2);

    const columns = await query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'widgets' ORDER BY ordinal_position`,
      [schemaName]
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual(['id', 'name', 'colour']);

    const seeded = await query(`SELECT name, colour FROM ${schemaName}.widgets`);
    expect(seeded.rows).toEqual([{ name: 'sprocket', colour: 'green' }]);
  });

  it('is idempotent when re-run', async () => {
    const second = await runMigrator(folder, databaseUrl.toString());
    expect(second.code, second.output).toBe(0);
    const journal = await query('SELECT count(*)::int AS applied FROM drizzle.__drizzle_migrations');
    expect(journal.rows[0].applied).toBe(2);
    const rows = await query(`SELECT count(*)::int AS total FROM ${schemaName}.widgets`);
    expect(rows.rows[0].total).toBe(1);
  });

  it('applies only the new migration when one is appended', async () => {
    writeMigrations(folder, [
      {
        tag: '0000_first',
        sql: `CREATE SCHEMA ${schemaName};
              CREATE TABLE ${schemaName}.widgets (id serial PRIMARY KEY, name text NOT NULL);`
      },
      {
        tag: '0001_second',
        sql: `ALTER TABLE ${schemaName}.widgets ADD COLUMN colour text;
              INSERT INTO ${schemaName}.widgets (name, colour) VALUES ('sprocket', 'green');`
      },
      {
        tag: '0002_third',
        sql: `ALTER TABLE ${schemaName}.widgets ADD COLUMN weight_grams integer;`
      }
    ]);

    const third = await runMigrator(folder, databaseUrl.toString());
    expect(third.code, third.output).toBe(0);
    const journal = await query('SELECT count(*)::int AS applied FROM drizzle.__drizzle_migrations');
    expect(journal.rows[0].applied).toBe(3);
    const hasWeight = await query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'widgets' AND column_name = 'weight_grams'`,
      [schemaName]
    );
    expect(hasWeight.rowCount).toBe(1);
  });

  it('fails on a broken migration without recording it', async () => {
    writeMigrations(folder, [
      {
        tag: '0000_first',
        sql: `CREATE SCHEMA ${schemaName};
              CREATE TABLE ${schemaName}.widgets (id serial PRIMARY KEY, name text NOT NULL);`
      },
      {
        tag: '0001_second',
        sql: `ALTER TABLE ${schemaName}.widgets ADD COLUMN colour text;
              INSERT INTO ${schemaName}.widgets (name, colour) VALUES ('sprocket', 'green');`
      },
      {
        tag: '0002_third',
        sql: `ALTER TABLE ${schemaName}.widgets ADD COLUMN weight_grams integer;`
      },
      {
        tag: '0003_broken',
        sql: 'THIS IS NOT VALID SQL;'
      }
    ]);

    const fourth = await runMigrator(folder, databaseUrl.toString());
    expect(fourth.code).toBe(1);
    expect(fourth.output).toContain('Migration failed');

    // The broken migration must not be journalled, so a fixed re-run can still apply it.
    const journal = await query('SELECT count(*)::int AS applied FROM drizzle.__drizzle_migrations');
    expect(journal.rows[0].applied).toBe(3);
  });
});
