/**
 * Validates the GitHub Actions CI workflow at .github/workflows/ci.yml.
 * Parses the YAML and makes structural assertions — no network access needed.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import yaml from 'js-yaml'

const __dirname = dirname(fileURLToPath(import.meta.url))
// From peridot-mcp-server/src/__tests__/ → up 3 levels → repo root
const CI_YML_PATH = join(__dirname, '../../../.github/workflows/ci.yml')

const raw = readFileSync(CI_YML_PATH, 'utf8')
const workflow = yaml.load(raw) as Record<string, unknown>

describe('.github/workflows/ci.yml', () => {
  it('is valid YAML (js-yaml does not throw)', () => {
    expect(() => yaml.load(raw)).not.toThrow()
  })

  it('has a "name" field', () => {
    expect(typeof workflow['name']).toBe('string')
    expect((workflow['name'] as string).length).toBeGreaterThan(0)
  })

  describe('trigger (on)', () => {
    const on = workflow['on'] as Record<string, unknown>

    it('triggers on push', () => {
      expect(on).toHaveProperty('push')
    })

    it('triggers on pull_request', () => {
      expect(on).toHaveProperty('pull_request')
    })

    it('push targets the main branch', () => {
      const push = on['push'] as Record<string, unknown>
      expect(push['branches']).toContain('main')
    })

    it('pull_request targets the main branch', () => {
      const pr = on['pull_request'] as Record<string, unknown>
      expect(pr['branches']).toContain('main')
    })
  })

  describe('jobs', () => {
    const jobs = workflow['jobs'] as Record<string, unknown>

    it('has at least one job', () => {
      expect(Object.keys(jobs).length).toBeGreaterThan(0)
    })

    const firstJob = Object.values(jobs)[0] as Record<string, unknown>
    const steps = firstJob['steps'] as Array<Record<string, unknown>>

    it('runs on ubuntu-latest', () => {
      expect(firstJob['runs-on']).toBe('ubuntu-latest')
    })

    it('has a steps array with at least one entry', () => {
      expect(Array.isArray(steps)).toBe(true)
      expect(steps.length).toBeGreaterThan(0)
    })

    it('includes a typecheck step', () => {
      const hasTypecheck = steps.some(
        (s) => typeof s['run'] === 'string' && s['run'].includes('typecheck'),
      )
      expect(hasTypecheck).toBe(true)
    })

    it('includes a test step', () => {
      const hasTest = steps.some(
        (s) =>
          typeof s['run'] === 'string' &&
          /\btest\b/.test(s['run']) &&
          !s['run'].includes('typecheck'),
      )
      expect(hasTest).toBe(true)
    })

    it('uses Node 20', () => {
      const setupNode = steps.find(
        (s) => typeof s['uses'] === 'string' && s['uses'].startsWith('actions/setup-node'),
      )
      expect(setupNode).toBeDefined()
      const nodeWith = (setupNode as Record<string, unknown>)['with'] as Record<string, unknown>
      expect(String(nodeWith['node-version'])).toBe('20')
    })

    it('uses pnpm/action-setup', () => {
      const setupPnpm = steps.find(
        (s) => typeof s['uses'] === 'string' && s['uses'].startsWith('pnpm/action-setup'),
      )
      expect(setupPnpm).toBeDefined()
    })

    it('includes a checkout step', () => {
      const checkout = steps.find(
        (s) => typeof s['uses'] === 'string' && s['uses'].startsWith('actions/checkout'),
      )
      expect(checkout).toBeDefined()
    })
  })

  describe('secrets / hardcoded credentials', () => {
    it('does not contain DATABASE_URL', () => {
      expect(raw).not.toContain('DATABASE_URL')
    })

    it('does not contain any postgres:// connection string', () => {
      expect(raw).not.toMatch(/postgres(ql)?:\/\//)
    })

    it('does not contain any hardcoded API keys or tokens (no Bearer or ghp_)', () => {
      expect(raw).not.toMatch(/Bearer\s+[A-Za-z0-9]/i)
      expect(raw).not.toMatch(/ghp_[A-Za-z0-9]+/)
    })
  })
})
