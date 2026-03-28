// コメント欄への「コメントを翻訳」ボタン注入。通常動画と Shorts の両方に対応。
(function (App) {
  let onTranslateComments = null;

  function setOnTranslate(cb) { onTranslateComments = cb; }

  function setupCommentTranslateBtn(doc) {
    const enabled = App.state.chatTranslateEnabled && App.state.apiKeyConfigured;

    // 通常動画のコメント欄（display 切り替え）
    setupBtnToggle(doc, "ytc-translate-visible-btn-comment", enabled,
      () => doc.querySelector("ytd-comments #header #title #additional-section"));

    // Shorts のコメントパネル（削除/再作成）
    setupBtnRecreate(doc, "ytc-translate-visible-btn-shorts", enabled,
      () => doc.querySelector("ytd-engagement-panel-title-header-renderer yt-sort-filter-sub-menu-renderer"));
  }

  function setupBtnToggle(doc, id, enabled, findAnchor) {
    const existing = doc.querySelector("#" + id);
    if (existing) {
      existing.style.display = enabled ? "" : "none";
      return;
    }
    if (!enabled) return;
    const anchor = findAnchor();
    if (anchor) createBtn(doc, id, anchor, anchor.parentNode);
  }

  function setupBtnRecreate(doc, id, enabled, findAnchor) {
    const existing = doc.querySelector("#" + id);
    if (!enabled) {
      if (existing) existing.remove();
      return;
    }
    if (existing) return;
    const anchor = findAnchor();
    if (anchor) createBtn(doc, id, anchor, anchor.parentNode);
  }

  function createBtn(doc, id, before, parent) {
    const btn = doc.createElement("button");
    btn.id = id;
    btn.className = "ytc-translate-visible-btn ytc-translate-visible-btn-inline";
    btn.textContent = "コメントを翻訳";
    btn.title = "表示中のコメントを翻訳";
    btn.onclick = () => { if (onTranslateComments) onTranslateComments(); };
    parent.insertBefore(btn, before);
  }

  App.comments = {
    setupCommentTranslateBtn,
    setOnTranslate,
  };
})(UbyeApp);
