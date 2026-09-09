@echo off
set PATH=C:\nvm4w;C:\nvm4w\nodejs;%PATH%
pnpm exec turbo run dev --filter=web -- --port 3010
