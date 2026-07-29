export function runSerializableTransaction(sql, work) {
  return sql.begin("isolation level serializable", work);
}
