import { businessError, validationError } from "../lib/errors.js";
import {
  seedLoadTestAvatarsFromBuffer,
} from "./developerLoadTestService.js";
import { loadTestCheckIn } from "./developerToolsService.js";

export type StressTestMode = "avatar" | "checkin" | "both";

export type StressTestStatus = {
  running: boolean;
  mode: StressTestMode | null;
  started_at: string | null;
  iterations: number;
  errors: number;
  last_error: string | null;
};

type StressSession = {
  developerId: string;
  mode: StressTestMode;
  abort: AbortController;
  startedAt: number;
  iterations: number;
  errors: number;
  lastError: string | null;
  photoBuffer: Buffer | null;
  intervalMs: number;
};

let activeSession: StressSession | null = null;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      },
      { once: true }
    );
  });
}

async function runStressLoop(session: StressSession): Promise<void> {
  try {
    while (!session.abort.signal.aborted) {
      try {
        if (session.mode === "avatar" || session.mode === "both") {
          if (!session.photoBuffer) {
            throw new Error("Foto uji belum diunggah untuk mode avatar");
          }
          await seedLoadTestAvatarsFromBuffer(session.photoBuffer);
        }
        if (session.mode === "checkin" || session.mode === "both") {
          await loadTestCheckIn({ all: true });
        }
        session.iterations++;
      } catch (err) {
        session.errors++;
        session.lastError =
          err instanceof Error ? err.message : String(err);
      }

      await sleep(session.intervalMs, session.abort.signal);
    }
  } catch {
    // stopped via abort
  } finally {
    if (activeSession === session) {
      activeSession = null;
    }
  }
}

export function getStressTestStatus(): StressTestStatus {
  if (!activeSession) {
    return {
      running: false,
      mode: null,
      started_at: null,
      iterations: 0,
      errors: 0,
      last_error: null,
    };
  }
  return {
    running: true,
    mode: activeSession.mode,
    started_at: new Date(activeSession.startedAt).toISOString(),
    iterations: activeSession.iterations,
    errors: activeSession.errors,
    last_error: activeSession.lastError,
  };
}

export async function startDeveloperStressTest(
  developerId: string,
  options: {
    mode: StressTestMode;
    interval_ms?: number;
    photo_buffer?: Buffer;
  }
): Promise<StressTestStatus> {
  if (activeSession) {
    if (activeSession.developerId === developerId) {
      return getStressTestStatus();
    }
    throw businessError("Stress test sedang berjalan oleh sesi lain");
  }

  const mode = options.mode;
  const intervalMs = Math.min(
    60_000,
    Math.max(1000, Number(options.interval_ms ?? 3000))
  );

  if ((mode === "avatar" || mode === "both") && !options.photo_buffer?.length) {
    throw validationError(
      "Upload foto dulu untuk stress test mode avatar/both"
    );
  }

  const session: StressSession = {
    developerId,
    mode,
    abort: new AbortController(),
    startedAt: Date.now(),
    iterations: 0,
    errors: 0,
    lastError: null,
    photoBuffer: options.photo_buffer ?? null,
    intervalMs,
  };

  activeSession = session;
  void runStressLoop(session);
  return getStressTestStatus();
}

export function stopDeveloperStressTest(developerId: string): StressTestStatus {
  if (!activeSession) {
    return getStressTestStatus();
  }
  if (activeSession.developerId !== developerId) {
    throw businessError("Bukan sesi stress test Anda");
  }
  activeSession.abort.abort();
  const finalStatus = getStressTestStatus();
  activeSession = null;
  return { ...finalStatus, running: false };
}
