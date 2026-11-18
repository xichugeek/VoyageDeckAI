import { defineConfig } from '@playwright/test'
import { randomBytes } from 'node:crypto'

process.env.VOYAGEDECK_E2E_SYNTHETIC_PASSWORD ??= randomBytes(24).toString('base64url')

const python = process.platform === 'win32'
  ? '../backend/.venv/Scripts/python.exe'
  : '../backend/.venv/bin/python'

export default defineConfig({
  testDir: './tests',
  testMatch: 'admin.e2e.ts',
  outputDir: './.local/admin-e2e-tests',
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5181' },
  webServer: [
    { command: `"${python}" tests/admin-backend.py`, url: 'http://127.0.0.1:8291/api/health', timeout: 25_000 },
    {
      command: 'npm run dev -- --port 5181',
      url: 'http://127.0.0.1:5181',
      env: {
        VOYAGEDECK_LOCAL_API_TARGET: 'http://127.0.0.1:8291',
        VOYAGEDECK_E2E_SYNTHETIC_PASSWORD: '',
      },
      timeout: 25_000,
    },
  ],
})
