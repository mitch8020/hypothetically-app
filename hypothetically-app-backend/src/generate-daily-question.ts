import { NestFactory } from '@nestjs/core';

async function generateDailyQuestion(): Promise<void> {
  process.env.DAILY_QUESTION_SCHEDULER_RUN = 'true';
  const [{ AppModule }, { QuestionsService }] = await Promise.all([
    import('./app.module.js'),
    import('./questions/questions.service.js'),
  ]);
  const application = await NestFactory.createApplicationContext(AppModule);

  try {
    const force = process.argv.includes('--force');
    const result = await application
      .get(QuestionsService)
      .generateFromScheduler(new Date(), force);
    const dayKey =
      result.status === 'ready' ? result.question.dayKey : result.dayKey;
    console.log(`daily-question:${result.status}:${dayKey ?? 'legacy'}`);
  } finally {
    await application.close();
  }
}

void generateDailyQuestion().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : 'Unknown Scheduler failure';
  console.error(`daily-question:failed:${message}`);
  process.exitCode = 1;
});
