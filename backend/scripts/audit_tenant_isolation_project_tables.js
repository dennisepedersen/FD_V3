require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.production') });
const { Pool } = require('pg');

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    const tables = ['project_wip', 'project_masterdata_v4'];

    const columns = await pool.query(
      `
      SELECT table_name, column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
      ORDER BY table_name, ordinal_position
      `,
      [tables]
    );

    const constraints = await pool.query(
      `
      SELECT
        tc.table_name,
        tc.constraint_name,
        tc.constraint_type,
        string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) AS columns,
        ccu.table_name AS ref_table,
        string_agg(ccu.column_name, ', ' ORDER BY kcu.ordinal_position) AS ref_columns
      FROM information_schema.table_constraints tc
      LEFT JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
       AND tc.table_name = kcu.table_name
      LEFT JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name
       AND tc.table_schema = ccu.table_schema
      WHERE tc.table_schema = 'public'
        AND tc.table_name = ANY($1::text[])
      GROUP BY tc.table_name, tc.constraint_name, tc.constraint_type, ccu.table_name
      ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name
      `,
      [tables]
    );

    const indexes = await pool.query(
      `
      SELECT tablename AS table_name, indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = ANY($1::text[])
      ORDER BY tablename, indexname
      `,
      [tables]
    );

    const externalRefUniq = await pool.query(
      `
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'project_core'
        AND indexname = 'uq_project_core_tenant_external_ref'
      `
    );

    const projectCorePk = await pool.query(
      `
      SELECT conname, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'public.project_core'::regclass
        AND contype IN ('p','u')
      ORDER BY conname
      `
    );

    const result = {
      columns: columns.rows,
      constraints: constraints.rows,
      indexes: indexes.rows,
      project_core_reference_uniques: {
        indexes: externalRefUniq.rows,
        constraints: projectCorePk.rows,
      },
    };

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
