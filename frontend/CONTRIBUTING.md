# Contributing to Duolicious

We’re excited you’re here! This guide will help you get productive quickly and submit great pull requests.

---

## How to contribute

- Report bugs and request features by opening issues
- Tackle a good first issue or help triage existing ones
- Submit pull requests for fixes, tests, docs, or enhancements

If you’re unsure about an approach, open a draft PR early for feedback.

---

## Development setup (5 minutes)

```bash
npm install
npm run web   # or: npm run android | npm run ios
```

See `DEVELOPER.md` for environment variables, tests, and troubleshooting.

---

## Pull request checklist

Before you submit:

- [ ] Runs locally: `npm run web` (or on device)
- [ ] Tests pass: `npm test`
- [ ] Type checks pass: `npm run typecheck`
- [ ] Lint passes: `npm run lint` (consider `npx eslint . --fix`)
- [ ] E2E relevant? If yes, add/update Playwright tests or snapshots
- [ ] Updated docs if behavior or setup changed
- [ ] Small, focused PR with a descriptive title

PR tips:
- Prefer small, incremental PRs over mega-PRs
- Add screenshots or screen recordings for UI changes
- Mark as Draft if still iterating

---

## Issue guidelines

When filing an issue, please include:
- Expected vs actual behavior
- Steps to reproduce
- Environment (web/Android/iOS, OS, versions)
- Logs or screenshots if helpful

---

## Code style

- TypeScript preferred where applicable
- Keep code readable and well-named; avoid unnecessary complexity
- Add tests for critical logic and regression risks

---

Thanks for helping people find love on the internet! 💜 
