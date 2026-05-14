# gpt-image-2 生成命令

> 当前本机未检测到 `OPENAI_API_KEY`，配置后再执行以下命令。

## 配置 Key

PowerShell 临时配置：

```powershell
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$env:OPENAI_API_KEY="你的 OpenAI API Key"
```

或写入技能环境文件：

```text
C:/Users/Administrator/.baoyu-skills/.env
OPENAI_API_KEY=你的 OpenAI API Key
```

## 单张生成命令

```powershell
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
npx -y bun "C:/Users/Administrator/.agents/skills/baoyu-image-gen/scripts/main.ts" --provider openai --model gpt-image-2 --quality 2k --size 1024x1536 --promptfiles "E:/AI-Work/batch_rename/xhs-images/batch-renamer-promo/prompts/01-cover.md" --image "E:/AI-Work/batch_rename/xhs-images/batch-renamer-promo/output/01-cover.png"
```

## 全套顺序生成命令

```powershell
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$script="C:/Users/Administrator/.agents/skills/baoyu-image-gen/scripts/main.ts"
$base="E:/AI-Work/batch_rename/xhs-images/batch-renamer-promo"
npx -y bun $script --provider openai --model gpt-image-2 --quality 2k --size 1024x1536 --promptfiles "$base/prompts/01-cover.md" --image "$base/output/01-cover.png"
npx -y bun $script --provider openai --model gpt-image-2 --quality 2k --size 1024x1536 --promptfiles "$base/prompts/02-pain-points.md" --image "$base/output/02-pain-points.png"
npx -y bun $script --provider openai --model gpt-image-2 --quality 2k --size 1024x1536 --promptfiles "$base/prompts/03-features.md" --image "$base/output/03-features.png"
npx -y bun $script --provider openai --model gpt-image-2 --quality 2k --size 1024x1536 --promptfiles "$base/prompts/04-safety.md" --image "$base/output/04-safety.png"
npx -y bun $script --provider openai --model gpt-image-2 --quality 2k --size 1024x1536 --promptfiles "$base/prompts/05-cta.md" --image "$base/output/05-cta.png"
```
