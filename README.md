# IRON LOG ｜ 最短公開手順（localStorage版）

筋トレ記録アプリ「IRON LOG」を、最短でWebサイトとして公開するための一式です。
ダークテーマ・休憩タイマー・種目連動アフィリエイト広告つき。

- 記録は **この端末のブラウザ内（localStorage）** に保存されます。同じ端末なら残ります。
- Mac不要・費用ゼロ・審査なし・ログイン設定なし。早ければ当日公開できます。

---

## ステップ1：手元で動かす

1. **Node.js を入れる** … https://nodejs.org/ja の「LTS」版をインストール。
2. **VS Code でこのフォルダを開く**（https://code.visualstudio.com/ ）。
3. メニュー「ターミナル」→「新しいターミナル」を開き、順に実行：

   ```bash
   npm install
   npm run dev
   ```

4. 表示された `http://localhost:5173` をブラウザで開く。
   記録して再読み込みしても残っていればOK。

---

## ステップ2：アフィリエイトリンクを自分のものに差し替える（収益化）

`src/App.jsx` の上のほうにある `AD_PRODUCTS` を編集します。
各商品の **url**（あなた専用のアフィリエイトリンク）と **img**（規約に沿った商品画像URL）を差し替え。

- `match: ["ベンチ", "デッド"]` … この商品を出したい種目のキーワード（部分一致）
- `match: []` … どの種目でも出る「汎用」商品（プロテイン等）

> ⚠ カード左上の「PR」表記は、景品表示法（ステマ規制）対応のため **外さないでください**。

リンクは Amazonアソシエイト / 楽天アフィリエイト / A8.net / もしもアフィリエイト などで取得します。
各ASPの規約（特に画像の使い方）を必ず守ってください。

---

## ステップ3：GitHub に上げる

GitHub（https://github.com/ ）で新しいリポジトリ `iron-log` を作り、ターミナルで：

```bash
git init
git add .
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/あなたのユーザー名/iron-log.git
git push -u origin main
```

※ `git` 未導入なら https://git-scm.com/ からインストール。

---

## ステップ4：Vercel で公開する

1. https://vercel.com/ に **GitHub アカウントでログイン**。
2. 「Add New」→「Project」→ `iron-log` を選ぶ。
3. そのまま「Deploy」。数十秒で `iron-log-xxxx.vercel.app` のURLが発行されます。完成！

以降、コードを直して `git push` するたび、Vercel が自動で公開し直します。

---

## ステップ5（任意）：スマホでアプリ風に使う

公開URLをスマホで開き、
- iPhone(Safari)：共有 →「ホーム画面に追加」
- Android(Chrome)：メニュー →「ホーム画面に追加」

---

## 保存についての注意

- 記録は **その端末のそのブラウザの中だけ** に保存。別端末とは同期しません。
- ブラウザの履歴/データを消すと記録も消えます。
- 「機種変しても残したい・複数端末で見たい」段階になったら、
  ログイン＋クラウド保存（Firebase）版へ乗り換えるのがおすすめです。
  その場合 `src/App.jsx` 冒頭の `load()` / `save()` を差し替えるだけで移行できます。
