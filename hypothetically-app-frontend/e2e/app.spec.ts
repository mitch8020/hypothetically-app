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

const nextDayQuestion = {
  ...todayQuestion,
  key: 'daily-2026-07-29',
  prompt: 'How many pebbles could fit in your favorite coffee mug?',
  unit: 'pebbles',
  dayKey: '2026-07-29',
}

const lockedResult = {
  status: 'locked',
  question: todayQuestion,
  userAnswer: 42,
  unlocksAt: '2099-07-29T07:00:00.000Z',
  timeZone: 'America/Los_Angeles',
}

const unlockedResult = {
  status: 'unlocked',
  question: todayQuestion,
  median: 58.5,
  answerCount: 5,
  answerClusters: [
    { center: 42, count: 1, minimum: 42, maximum: 42 },
    { center: 58.5, count: 3, minimum: 57, maximum: 60 },
    { center: 75, count: 1, minimum: 75, maximum: 75 },
  ],
  leaders: [
    {
      rank: 1,
      displayName: 'Browser T.',
      value: 42,
      distanceFromMedian: 16.5,
      isCurrentUser: true,
    },
    {
      rank: 1,
      displayName: 'Friend F.',
      value: 75,
      distanceFromMedian: 16.5,
      isCurrentUser: false,
    },
  ],
  userEntry: {
    rank: 1,
    displayName: 'Browser T.',
    value: 42,
    distanceFromMedian: 16.5,
    distanceToWinner: 0,
    isCurrentUser: true,
  },
  winningEntry: {
    rank: 1,
    displayName: 'Browser T.',
    value: 42,
    distanceFromMedian: 16.5,
    isCurrentUser: true,
  },
  computedAt: '2026-07-28T16:00:00.000Z',
}

async function mockApi(
  page: Page,
  options: {
    signedIn: boolean
    alreadyAnswered?: boolean
    unlockAutomatically?: boolean
    onResultsRead?: () => void
    getTodayQuestion?: () => typeof todayQuestion
  },
) {
  let hasAnswered = options.alreadyAnswered ?? false
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
      await route.fulfill({
        json: options.getTodayQuestion?.() ?? todayQuestion,
      })
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
      expect(request.postDataJSON()).toEqual({
        value: 42,
        timeZone: expect.stringMatching(/^[A-Za-z_]+(?:\/[A-Za-z_+-]+)+$/),
      })
      hasAnswered = true
      await route.fulfill({
        status: 201,
        json: options.unlockAutomatically
          ? {
              ...lockedResult,
              unlocksAt: new Date(Date.now() + 50).toISOString(),
            }
          : lockedResult,
      })
      return
    }
    if (
      path === `/api/questions/${todayQuestion.key}/results` &&
      method === 'GET'
    ) {
      expect(new URL(request.url()).searchParams.get('timeZone')).toMatch(
        /^[A-Za-z_]+(?:\/[A-Za-z_+-]+)+$/,
      )
      if (!hasAnswered) {
        await route.fulfill({
          status: 403,
          json: {
            code: 'ANSWER_REQUIRED',
            message: 'Answer this question before seeing the crowd.',
          },
        })
        return
      }
      options.onResultsRead?.()
      await route.fulfill({
        json: options.alreadyAnswered ? lockedResult : unlockedResult,
      })
      return
    }
    if (
      path === '/api/questions/previous-unanswered' &&
      method === 'GET'
    ) {
      await route.fulfill({ json: previousQuestion })
      return
    }
    if (path === '/api/questions/random' && method === 'GET') {
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

async function expectAnswerLineLabelsToBeSeparated(page: Page) {
  const [headingBox, markerBox] = await Promise.all([
    page.locator('.answer-line figcaption strong').boundingBox(),
    page.locator('.median-marker b').boundingBox(),
  ])

  expect(headingBox).not.toBeNull()
  expect(markerBox).not.toBeNull()
  expect(headingBox!.y + headingBox!.height + 4).toBeLessThanOrEqual(
    markerBox!.y,
  )
}

async function expectCrowdTicketLabelsToBeSeparated(page: Page) {
  const [titleBox, subtitleBox] = await Promise.all([
    page.locator('.crowd-ticket strong').boundingBox(),
    page.locator('.crowd-ticket > span').boundingBox(),
  ])

  expect(titleBox).not.toBeNull()
  expect(subtitleBox).not.toBeNull()
  expect(titleBox!.y + titleBox!.height + 4).toBeLessThanOrEqual(
    subtitleBox!.y,
  )
}

test('guest lands on the one shared daily question with an accessible Google entry point', async ({
  page,
}) => {
  let currentTodayQuestion = todayQuestion
  await mockApi(page, {
    signedIn: false,
    getTodayQuestion: () => currentTodayQuestion,
  })
  await page.goto('/')

  await expect(page).toHaveURL('/q/today')
  await expect(
    page.getByRole('heading', { name: todayQuestion.prompt }),
  ).toBeVisible()
  await expect(page.getByText('Question of the day')).toBeVisible()
  await expect(page.getByText('1 new question')).toHaveCount(1)

  const googleLink = page.getByRole('link', { name: 'Sign in with Google' })
  await expect(googleLink).toHaveAttribute(
    'href',
    '/api/auth/google?returnTo=%2Fq%2Ftoday',
  )
  await expect(
    page.getByRole('link', { name: 'Hypothetically' }),
  ).toHaveAttribute(
    'href',
    'https://shop.iv.studio/products/hypothetically-board-game-limited-edition?srsltid=AfmBOoqJSC-djTIg78pY0-pgCw73XHQw-7qxdgtuv7bl06RXhEjYZAdC',
  )
  await expect(
    page.getByRole('navigation', { name: 'Creator links' }),
  ).toBeVisible()

  await page.keyboard.press('Tab')
  await expect(
    page.getByRole('link', { name: 'How Many? home' }),
  ).toBeFocused()
  expect(await seriousA11yViolations(page)).toEqual([])

  currentTodayQuestion = nextDayQuestion
  await page.reload()

  await expect(page).toHaveURL('/q/today')
  await expect(
    page.getByRole('heading', { name: nextDayQuestion.prompt }),
  ).toBeVisible()
})

test('returning user sees the already-answered view on today', async ({
  page,
}) => {
  let resultsReads = 0
  await mockApi(page, {
    signedIn: true,
    alreadyAnswered: true,
    onResultsRead: () => {
      resultsReads += 1
    },
  })

  await page.goto('/q/today')

  await expect(
    page.getByText('You’ve answered this question already.'),
  ).toBeVisible()
  await expect(
    page.getByRole('spinbutton', { name: 'Your answer' }),
  ).toHaveCount(0)
  expect(resultsReads).toBe(1)
  expect(await seriousA11yViolations(page)).toEqual([])

  await page.getByRole('button', { name: 'See your result' }).click()

  await expect(page).toHaveURL(`/q/${todayQuestion.key}/results`)
  await expect(page.getByText('Midnight', { exact: true })).toBeVisible()
  await expectCrowdTicketLabelsToBeSeparated(page)
  await expect(page.locator('.median-board')).toHaveCount(0)
  expect(resultsReads).toBe(1)
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
    page.getByLabel(/Crowd results unlock at/),
  ).toBeVisible()
  await expect(page.getByText('Midnight', { exact: true })).toBeVisible()
  await expectCrowdTicketLabelsToBeSeparated(page)
  await expect(page.locator('.median-board')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'X' })).toHaveAttribute(
    'href',
    /twitter\.com\/intent\/tweet/,
  )
  await expect(page.getByRole('link', { name: 'Facebook' })).toBeVisible()
  await expect(
    page
      .getByLabel('Share to a social feed')
      .getByRole('link', { name: 'LinkedIn' }),
  ).toBeVisible()

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
    .getByRole('button', { name: 'Check now' })
    .click()
  await expect(page.locator('.median-board')).toBeVisible()
  await expect(page.locator('.median-board strong')).toHaveText('59')
  await expect(page.locator('.answer-cluster')).toHaveCount(3)
  await expect(page.locator('.answer-dot')).toHaveCount(4)
  await expect(page.locator('.answer-cluster').nth(1).locator('.answer-dot')).toHaveCount(2)
  await expect(page.locator('.median-marker b')).toHaveText('Median')
  await expect(page.locator('.median-marker i')).toHaveCount(1)
  await expect(page.locator('.answer-token')).toHaveCount(0)
  await expect(
    page.getByRole('region', { name: 'The leaderboard' }),
  ).toBeVisible()
  await expect(page.getByText('Your place')).toBeVisible()
  await expectAnswerLineLabelsToBeSeparated(page)
  expect(resultsReads).toBe(1)
  expect(await seriousA11yViolations(page)).toEqual([])

  await page.screenshot({
    path: testInfo.outputPath('unlocked-result.png'),
    fullPage: true,
  })

  await page
    .getByRole('button', { name: 'Answer a random question' })
    .click()
  await expect(page).toHaveURL(`/q/${previousQuestion.key}`)
  await expect(
    page.getByRole('heading', { name: previousQuestion.prompt }),
  ).toBeVisible()
})

test('sealed crowd results reveal automatically after the server unlock time', async ({
  page,
}) => {
  let resultsReads = 0
  await mockApi(page, {
    signedIn: true,
    unlockAutomatically: true,
    onResultsRead: () => {
      resultsReads += 1
    },
  })
  await page.goto(`/q/${todayQuestion.key}`)

  await page.getByRole('spinbutton', { name: 'Your answer' }).fill('42')
  await page.getByRole('button', { name: 'Lock in my answer' }).click()

  await expect(page.getByText('Midnight', { exact: true })).toBeVisible()
  await expect(page.locator('.median-board')).toBeVisible({
    timeout: 3_000,
  })
  expect(resultsReads).toBe(1)
})
