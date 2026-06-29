/** Error ingest yang tidak akan berhasil di-retry (hindari retry storm BullMQ). */
export function isTerminalIngestError(message: string): boolean {
  return (
    message.startsWith("INGEST_WORK_DATE_OUT_OF_RANGE:") ||
    message.startsWith("BRANCH_NOT_RESOLVED:") ||
    message.startsWith("EMPLOYEE_NAME_MISMATCH:") ||
    message.startsWith("PARSER_") ||
    message === "CHECK_IN_ALREADY_RECORDED" ||
    message === "BREAK_SESSION_NOT_OPEN" ||
    message.startsWith("DUPLICATE_ATTENDANCE:")
  );
}
