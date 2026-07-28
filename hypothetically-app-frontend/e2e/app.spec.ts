import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

const todayQuestion = {
  key: 'daily-2026-07-28',
  prompt: 'How many sidewalk cracks could you step over on a long walk?',
  unit: 'cracks',
  minimum: 0,
  maximum: 1_000_000,
  step: 1,
  precision: 0,
  dayKey: '2026-07-28',
}

const previousQuestion = {
  key: 'daily-2026-07-27',
  prompt: 'How many soap bubbles could cover the surface of your bathtub?',
  unit: 'bubbles',
  minimum: 0,
  maximum: 10_000_000,
  step: 1,
  precision: 0,
  dayKey: '2026-07-27',
}

const lockedResult = {
  status: 'locked',
  question: todayQuestion,
  userAnswer: 42,
  answerCount: 1,
  requiredAnswerCount: 2,
  remainingAnswerCount: 1,
}

const unlockedResult = {
  status: 'unlocked',
  question: todayQuestion,
  average: 58.5,
  answerCount: 2,
  requiredAnswerCount: 2,
  remainingAnswerCount: 0,
  leaders: [
    {
      rank: 1,
      displayName: 'Browser T.',
      value: 42,
      distanceFromAverage: 16.5,
      isCurrentUser: true,
    },
    {
      rank: 1,
      displayName: 'Friend F.',
      value: 75,
      distanceFromAverage: 16.5,
      isCurrentUser: false,
    },
  ],
  userEntry: {
    rank: 1,
    displayName: 'Browser T.',
    value: 42,
    distanceFromAverage: 16.5,
    distanceToWinner: 0,
    isCurrentUser: true,
  },
  winningEntry: {
    rank: 1,
    displayName: 'Browser T.',
    value: 42,
    distanceFromAverage: 16.5,
    isCurrentUser: true,
  },
  computedAt: '2026-07-28T16:00:00.000Z',
}

async function mockApi(
  page: Page,
  options: {
    signedIn: boolean
    onResultsRead?: () => void
  },
) {
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const method = request.method()

    if (path === '/api/traffic/visit' && method === 'POST') {
      await route.fulfill({ status: 204 })
      return
    }
    if (path === '/api/auth/me') {
      await route.fulfill({
        json: options.signedIn
          ? {
              user: {
                firstName: 'Browser',
                lastInitial: 'T',
                displayName: 'Browser T.',
              },
            }
          : { user: null },
      })
      return
    }
    if (path === '/api/questions/today') {
      await route.fulfill({ json: todayQuestion })
      return
    }
    if (path === `/api/questions/${todayQuestion.key}` && method === 'GET') {
      await route.fulfill({ json: todayQuestion })
      return
    }
    if (
      path === `/api/questions/${todayQuestion.key}/answer` &&
      method === 'POST'
    ) {
      expect(request.postDataJSON()).toEqual({ value: 42 })
      await route.fulfill({ status: 201, json: lockedResult })
      return
    }
    if (
      path === `/api/questions/${todayQuestion.key}/results` &&
      method === 'GET'
    ) {
      options.onResultsRead?.()
      await route.fulfill({ json: unlockedResult })
      return
    }
    if (
      path === '/api/questions/previous-unanswered' &&
      method === 'GET'
    ) {
      await route.fulfill({ json: previousQuestion })
      return
    }
    if (
      path === `/api/questions/${previousQuestion.key}` &&
      method === 'GET'
    ) {
      await route.fulfill({ json: previousQuestion })
      return
    }

    throw new Error(`Unexpected API request: ${method} ${path}`)
  })
}

function seriousA11yViolations(page: Page) {
  return new AxeBuilder({ page })
    .analyze()
    .then((result) =>
      result.violations.filter(
        (violation) =>
          violation.impact === 'critical' || violation.impact === 'serious',
      ),
    )
}

test('guest lands on the one shared daily question with an accessible Google entry point', async ({
  page,
}) => {
  await mockApi(page, { signedIn: false })
  await page.goto('/')

  await expect(page).toHaveURL(`/q/${todayQuestion.key}`)
  await expect(
    page.getByRole('heading', { name: todayQuestion.prompt }),
  ).toBeVisible()
  await expect(page.getByText('Question of the day')).toBeVisible()
  await expect(page.getByText('1 new question')).toHaveCount(1)

  const googleLink = page.getByRole('link', { name: 'Sign in with Google' })
  await expect(googleLink).toHaveAttribute(
    'href',
    `/api/auth/google?returnTo=%2Fq%2F${todayQuestion.key}`,
  )

  await page.keyboard.press('Tab')
  await expect(
    page.getByRole('link', { name: 'How Many, Though? home' }),
  ).toBeFocused()
  expect(await seriousA11yViolations(page)).toEqual([])
})

test('signed-in user moves from sealed answer to manual crowd unlock and backlog', async ({
  page,
  context,
}, testInfo) => {
  let resultsReads = 0
  await mockApi(page, {
    signedIn: true,
    onResultsRead: () => {
      resultsReads += 1
    },
  })
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')

  const input = page.getByRole('spinbutton', { name: 'Your answer' })
  await expect(input).toBeVisible()
  await input.fill('42')
  await page.getByRole('button', { name: 'Lock in my answer' }).click()

  await expect(page).toHaveURL(`/q/${todayQuestion.key}/results`)
  await expect(
    page.getByRole('heading', { name: '42 cracks' }),
  ).toBeVisible()
  await expect(
    page.getByLabel('1 out of 2 answers in'),
  ).toBeVisible()
  await expect(page.getByText(/1 more answer arrives/)).toBeVisible()
  await expect(page.getByText('The crowd average')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'X' })).toHaveAttribute(
    'href',
    /twitter\.com\/intent\/tweet/,
  )
  await expect(page.getByRole('link', { name: 'Facebook' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'LinkedIn' })).toBeVisible()

  await page.getByRole('button', { name: 'Copy question link' }).click()
  await expect(page.getByText('Question link copied.')).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    `/q/${todayQuestion.key}`,
  )

  await page.waitForTimeout(500)
  expect(resultsReads).toBe(0)
  expect(await seriousA11yViolations(page)).toEqual([])
  await page.screenshot({
    path: testInfo.outputPath('sealed-result.png'),
    fullPage: true,
  })

  await page
    .getByRole('button', { name: 'Check if it’s unlocked' })
    .click()
  await expect(page.getByText('The crowd average')).toBeVisible()
  await expect(
    page.getByRole('region', { name: 'The leaderboard' }),
  ).toBeVisible()
  await expect(page.getByText('Your place')).toBeVisible()
  expect(resultsReads).toBe(1)
  expect(await seriousA11yViolations(page)).toEqual([])

  await page.screenshot({
    path: testInfo.outputPath('unlocked-result.png'),
    fullPage: true,
  })

  await page
    .getByRole('button', { name: 'Answer an earlier question' })
    .click()
  await expect(page).toHaveURL(`/q/${previousQuestion.key}`)
  await expect(
    page.getByRole('heading', { name: previousQuestion.prompt }),
  ).toBeVisible()
})
