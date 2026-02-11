# 心理学理论流派谱系测试（纯静态 · GitHub Pages）

## 本地预览
推荐使用任一静态服务器（避免跨域读取 JSON）：

```bash
python -m http.server 8000
# 然后打开 http://localhost:8000
```

## 部署到 GitHub Pages（gh-pages 分支）
1. 新建仓库，把本项目文件放到仓库根目录（main 分支）。
2. 推送后，GitHub Actions 会自动把内容发布到 `gh-pages` 分支。
3. 仓库 Settings → Pages：
   - Source：Deploy from a branch
   - Branch：`gh-pages` / `/(root)`

## 主要内容文件
- `data/questions.json`：24 题（5轴×4 + 校准题4）
- `data/schools.json`：派别与标签
- `data/ideals.json`：5 轴定义、派别向量、混合规则
- `data/encyclopedia.json`：结果页/百科页模块内容（同结构）

## 备注
- 所有作答仅保存在浏览器本地（localStorage），不上传服务器。
