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
    // SPA 遷移後は非表示の古いパネルが DOM に残るため、可視パネル内の要素を探す
    setupBtnRecreate(doc, "ytc-translate-visible-btn-shorts", enabled,
      () => findVisibleSortFilter(doc));
  }

  function findVisibleSortFilter(doc) {
    for (const panel of doc.querySelectorAll("ytd-engagement-panel-title-header-renderer")) {
      if (!panel.offsetHeight) continue;
      const el = panel.querySelector("yt-sort-filter-sub-menu-renderer");
      if (el) return el;
    }
    return null;
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
