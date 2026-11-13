export type DiagnosticOperation =
  | "api"
  | "health"
  | "me"
  | "social-session"
  | "social-logout"
  | "access-list"
  | "access-save"
  | "access-remove"
  | "preferences-get"
  | "preferences-put"
  | "quiz-post"
  | "quiz-answer-post"
  | "quiz-attempts-get"
  | "admin-reminders-list"
  | "admin-reminders-save"
  | "admin-reminders-delete"
  | "piano-practice-post"
  | "piano-practice-get"
  | "sessions-list"
  | "session-get"
  | "chat-post"
  | "speech-token-post"
  | "cors-preflight";

export type ErrorCategory =
  | "configuration"
  | "persistence"
  | "context"
  | "model"
  | "speech"
  | "quota-unavailable"
  | "unexpected";

export interface DiagnosticEvent {
  operation: DiagnosticOperation;
  category: ErrorCategory;
}

export type DiagnosticLogger = (event: DiagnosticEvent) => void;

export function logUnexpectedFailure(
  logger: DiagnosticLogger | undefined,
  operation: DiagnosticOperation,
  category: ErrorCategory
): void {
  const event: DiagnosticEvent = { operation, category };
  if (logger) logger(event);
  else console.error(JSON.stringify(event));
}
