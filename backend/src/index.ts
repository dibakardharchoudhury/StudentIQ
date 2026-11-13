import { app } from "@azure/functions";
import { dispatch, createOperations, type ApiDependencies, type Operation } from "./api.js";
import { getConfig } from "./config.js";
import { AzureJsonBlobStore, SessionRepository } from "./storage.js";
import { AzureSpeechTokenProvider, FoundryTutor } from "./services.js";
import { DailyQuotaRepository } from "./quota.js";
import { logUnexpectedFailure, type DiagnosticOperation } from "./diagnostics.js";
import { ReminderRepository } from "./reminders.js";
import { PianoRepository } from "./piano.js";
import { PreferencesRepository } from "./preferences.js";
import { QuizRepository } from "./quiz.js";
import { FoundryQuizGenerator } from "./quiz-model.js";

let sharedDependencies: ApiDependencies | undefined;

function dependencies(): ApiDependencies {
  if (sharedDependencies) return sharedDependencies;
  const config = getConfig();
  const blobs = new AzureJsonBlobStore(config.blobEndpoint, config.blobContainer);
  const repository = new SessionRepository(blobs);
  sharedDependencies = {
    config,
    repository,
    reminders: new ReminderRepository(blobs),
    piano: new PianoRepository(blobs),
    preferences: new PreferencesRepository(blobs, config.preferenceDefaults),
    quiz: new QuizRepository(blobs),
    quizGenerator: new FoundryQuizGenerator(config),
    quota: new DailyQuotaRepository(blobs, config),
    tutor: new FoundryTutor(config),
    speech: new AzureSpeechTokenProvider(config)
  };
  return sharedDependencies;
}

function register(
  name: Exclude<DiagnosticOperation, "api">,
  route: string,
  methods: ("GET" | "POST" | "PUT" | "DELETE" | "OPTIONS")[],
  operation: Operation | null,
  options: { authenticated?: boolean; preflight?: boolean; adminOnly?: boolean } = {}
): void {
  app.http(name, {
    route,
    methods,
    authLevel: "anonymous",
    handler: async (request, context) => {
      try {
        if (name === "health") {
          const configuredOrigin = process.env.GITHUB_PAGES_ORIGIN;
          const origin = request.headers.get("origin");
          const cors: Record<string, string> = origin && configuredOrigin === origin
            ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" }
            : { Vary: "Origin" };
          return {
            status: 200,
            body: "ok",
            headers: { "Content-Type": "text/plain", "Cache-Control": "no-store", ...cors }
          };
        }
        return await dispatch(request, operation, {
          ...dependencies(),
          logError: (event) => context.error(event)
        }, { ...options, operationName: name });
      } catch {
        logUnexpectedFailure((event) => context.error(event), name, "configuration");
        return {
          status: 503,
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          jsonBody: { error: "The service is not configured." }
        };
      }
    }
  });
}

const operations = createOperations();

register("health", "health", ["GET"], operations.health, { authenticated: false });
register("me", "me", ["GET"], operations.me);
register("preferences-get", "preferences", ["GET"], operations.getPreferences);
register("preferences-put", "preferences", ["PUT"], operations.putPreferences);
register("quiz-post", "quiz", ["POST"], operations.createQuiz);
register("quiz-answer-post", "quiz/{id}/answer", ["POST"], operations.answerQuiz);
register("quiz-attempts-get", "quiz/attempts", ["GET"], operations.quizAttempts);
register("admin-reminders-list", "planning/reminders", ["GET"], operations.listReminders, { adminOnly: true });
register("admin-reminders-save", "planning/reminders", ["POST"], operations.saveReminder, { adminOnly: true });
register("admin-reminders-delete", "planning/reminders/{id}", ["DELETE"], operations.deleteReminder, { adminOnly: true });
register("piano-practice-post", "practice/piano", ["POST"], operations.recordPiano);
register("piano-practice-get", "practice/piano", ["GET"], operations.listPiano);
register("sessions-list", "sessions", ["GET"], operations.listSessions);
register("session-get", "sessions/{id}", ["GET"], operations.getSession);
register("chat-post", "chat", ["POST"], operations.chat);
register("speech-token-post", "speech/token", ["POST"], operations.speechToken);
register("cors-preflight", "{*path}", ["OPTIONS"], null, { preflight: true, authenticated: false });
