import { NestFactory } from '@nestjs/core';

interface SchedulerApplication {
  get<T>(token: unknown): T;
  close(): Promise<void>;
}

interface SchedulerDependencies {
  AppModule: unknown;
  QuestionsService: unknown;
}

/* istanbul ignore next -- Node's compiled .js loader is exercised by the scheduler smoke command. */
async function loadSchedulerDependencies(): Promise<{
  AppModule: unknown;
  QuestionsService: unknown;
}> {
  return Promise.all([
    import('./app.module.js'),
    import('./questions/questions.service.js'),
  ]).then(([app, questions]) => ({
    AppModule: app.AppModule,
    QuestionsService: questions.QuestionsService,
  }));
}

export async function generateDailyQuestion(
  loadDependencies: () => Promise<SchedulerDependencies>,
  argv: string[],
): Promise<void> {
  process.env.DAILY_QUESTION_SCHEDULER_RUN = 'true';
  const { AppModule, QuestionsService } = await loadDependencies();
  const application = (await NestFactory.createApplicationContext(
    AppModule as never,
  )) as unknown as SchedulerApplication;

  try {
    const force = argv.includes('--force');
    const result = await application.get<{
      generateFromScheduler(
        now?: Date,
        force?: boolean,
      ): Promise<
        | { status: 'ready'; question: { dayKey?: string } }
        | { status: 'skipped'; dayKey: string }
      >;
    }>(QuestionsService).generateFromScheduler(new Date(), force);
    const dayKey =
      result.status === 'ready' ? result.question.dayKey : result.dayKey;
    console.log(`daily-question:${result.status}:${dayKey ?? 'legacy'}`);
  } finally {
    await application.close();
  }
}

export async function runSchedulerCommand(
  loadDependencies: () => Promise<SchedulerDependencies> =
    loadSchedulerDependencies,
  argv: string[] = process.argv,
): Promise<void> {
  try {
    await generateDailyQuestion(loadDependencies, argv);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Unknown Scheduler failure';
    console.error(`daily-question:failed:${message}`);
    process.exitCode = 1;
  }
}

if (process.env.NODE_ENV !== 'test') {
  void runSchedulerCommand();
}
