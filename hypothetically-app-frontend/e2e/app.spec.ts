import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

test('guest sees a preserved question and accessible Google entry point', async ({
  page,
}) => {
  await page.goto('/q/doors-opened')

  await expect(
    page.getByRole('heading', {
      name: 'How many doors do you think you’ve opened in your lifetime?',
    }),
  ).toBeVisible()
  await expect(page.getByText('Got an answer?')).toBeVisible()

  const googleLink = page.getByRole('link', { name: 'Sign in with Google' })
  await expect(googleLink).toHaveAttribute(
    'href',
    '/api/auth/google?returnTo=%2Fq%2Fdoors-opened',
  )

  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'How Many, Though? home' })).toBeFocused()

  const accessibility = await new AxeBuilder({ page }).analyze()
  expect(
    accessibility.violations.filter(
      (violation) =>
        violation.impact === 'critical' || violation.impact === 'serious',
    ),
  ).toEqual([])
})

test('signed-in user completes a fixed snapshot and receives another question', async ({
  page,
}, testInfo) => {
  const subject = `Browser${testInfo.project.name}${Date.now()}`
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(
    `http://localhost:7000/api/test/auth/${encodeURIComponent(subject)}`,
  )
  await page.waitForURL(/\/q\/[^/]+$/)

  const firstUrl = page.url()
  await expect(page.getByRole('spinbutton', { name: 'Your answer' })).toBeVisible()

  let resultsReads = 0
  page.on('request', (request) => {
    if (
      request.method() === 'GET' &&
      /\/api\/questions\/[^/]+\/results$/.test(request.url())
    ) {
      resultsReads += 1
    }
  })

  const input = page.getByRole('spinbutton', { name: 'Your answer' })
  await input.fill('42')
  await page.getByRole('button', { name: 'Lock in my answer' }).click()

  await expect(page).toHaveURL(/\/q\/[^/]+\/results$/)
  await expect(page.getByText('The crowd average')).toBeVisible()
  await expect(page.getByRole('region', { name: 'The leaderboard' })).toBeVisible()
  await expect(page.getByText('Your place')).toBeVisible()

  await page.waitForTimeout(500)
  expect(resultsReads).toBe(0)

  const accessibility = await new AxeBuilder({ page }).analyze()
  expect(
    accessibility.violations.filter(
      (violation) =>
        violation.impact === 'critical' || violation.impact === 'serious',
    ),
  ).toEqual([])

  await page.screenshot({
    path: testInfo.outputPath('result.png'),
    fullPage: true,
  })

  await page.getByRole('button', { name: 'Answer Another Question' }).click()
  await page.waitForURL(/\/q\/[^/]+$/)
  expect(page.url()).not.toBe(firstUrl)
  await expect(page.getByRole('spinbutton', { name: 'Your answer' })).toBeVisible()
})
