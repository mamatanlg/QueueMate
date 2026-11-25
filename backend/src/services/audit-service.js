export async function writeAuditLog(client, {
  actor = null,
  action,
  affectedTable = null,
  affectedRecordId = null,
  details = {},
}) {
  await client.query(
    `INSERT INTO audit_logs
       (actor_staff_id, actor_username, actor_role, action,
        affected_table, affected_record_id, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      actor?.staff_id ?? actor?.id ?? null,
      actor?.username ?? null,
      actor?.role ?? null,
      action,
      affectedTable,
      affectedRecordId,
      JSON.stringify(details),
    ],
  )
}

export async function listAuditLogs({ database }) {
  const result = await database.query(`
    SELECT id, actor_staff_id, actor_username, actor_role, action,
           affected_table, affected_record_id, details, created_at
    FROM audit_logs
    ORDER BY created_at DESC, id DESC
    LIMIT 100
  `)

  return result.rows.map((row) => ({
    id: row.id,
    actor: row.actor_staff_id || row.actor_username
      ? {
          staffId: row.actor_staff_id,
          username: row.actor_username,
          role: row.actor_role,
        }
      : null,
    action: row.action,
    affectedRecord: row.affected_table
      ? {
          table: row.affected_table,
          id: row.affected_record_id,
        }
      : null,
    details: row.details,
    timestamp: row.created_at,
  }))
}
