# RMUC 2026 分区赛战术数据可视化

这是一个纯静态网页项目，可直接部署到 GitHub Pages。

## 本地预览

```bash
python3 -m http.server 8765
```

然后打开：

```text
http://127.0.0.1:8765/
```

项目也内嵌了 `data.js`，直接打开 `index.html` 时不依赖 `fetch()` 读取 CSV。

## GitHub Pages 部署

将本目录内容提交到 GitHub 仓库根目录，例如：

```bash
git init
git add .
git commit -m "Add RMUC 2026 visualization dashboard"
git branch -M main
git remote add origin git@github.com:<owner>/<repo>.git
git push -u origin main
```

在 GitHub 仓库设置中启用：

- Settings
- Pages
- Build and deployment: Deploy from a branch
- Branch: `main`
- Folder: `/ (root)`

发布后访问：

```text
https://<owner>.github.io/<repo>/
```

本项目使用相对路径引用资源，适配 GitHub Pages 的子路径部署方式。
