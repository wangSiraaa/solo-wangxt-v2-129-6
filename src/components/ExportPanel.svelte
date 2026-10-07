<script lang="ts">
  import { editor } from '../lib/state.svelte';
  import { coordLabel, exportPuzzle, type PuzzleDiff } from '../lib/puzzle';

  let message = $state('');
  let messageKind = $state<'ok' | 'error'>('ok');
  let importOpen = $state(false);
  let importText = $state('');
  let confirming = $state(false);

  const preview = $derived(editor.importPreview);

  function exportJson(): string {
    // 导出题面：exportPuzzle 只含 regions/givens/thermometers，
    // 不含 solution / lastCheck 等作者私有答案层。
    return JSON.stringify(exportPuzzle(editor.puzzle), null, 2);
  }

  function download() {
    const blob = new Blob([exportJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${editor.draftName || 'puzzle'}.puzzle.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMessage('已导出题面文件（不含答案层）');
  }

  async function copy() {
    await navigator.clipboard.writeText(exportJson());
    setMessage('题面 JSON 已复制到剪贴板（不含答案层）');
  }

  function setMessage(text: string, kind: 'ok' | 'error' = 'ok') {
    message = text;
    messageKind = kind;
  }

  function previewImport() {
    if (!importText.trim()) {
      setMessage('请先粘贴题面 JSON 或选择文件', 'error');
      return;
    }
    try {
      const data = JSON.parse(importText);
      const diff = editor.prepareImport(data);
      message = '';
      if (!diff.hasChanges) setMessage('导入题面与当前草稿完全相同，确认不会改动内容');
    } catch (e) {
      setMessage('导入被拒绝：' + (e instanceof Error ? e.message : String(e)), 'error');
    }
  }

  async function confirmImport() {
    confirming = true;
    try {
      await editor.confirmImport();
      setMessage('导入已确认：旧检查结论已失效，并已自动保存当前草稿');
      importOpen = false;
      importText = '';
    } catch (e) {
      setMessage('自动保存失败，题面已替换但未写入 IndexedDB：' + (e instanceof Error ? e.message : String(e)), 'error');
    } finally {
      confirming = false;
    }
  }

  function cancelImport() {
    editor.cancelImport();
    setMessage('已取消导入，当前草稿未改动');
  }

  function toggleImport() {
    if (importOpen) {
      // 收起面板等同取消：关闭差异预览并解锁画布，草稿字节不变
      importOpen = false;
      editor.cancelImport();
      message = '';
    } else {
      importOpen = true;
    }
  }

  function onFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    importOpen = true;
    const reader = new FileReader();
    reader.onload = () => {
      importText = String(reader.result ?? '');
      previewImport();
    };
    reader.onerror = () => setMessage('读取文件失败：' + (reader.error?.message ?? '未知错误'), 'error');
    reader.readAsText(file);
    input.value = '';
  }

  function givenText(diff: PuzzleDiff['givens'][number]): string {
    if (diff.type === 'added') return `${coordLabel(diff.cell)} 新增提示 ${diff.after}`;
    if (diff.type === 'removed') return `${coordLabel(diff.cell)} 删除提示 ${diff.before}`;
    return `${coordLabel(diff.cell)} 提示 ${diff.before} → ${diff.after}`;
  }
</script>

<div class="panel">
  <h4>题面导入 / 导出</h4>
  <div class="row">
    <button onclick={download}>下载题面 JSON</button>
    <button onclick={copy}>复制题面</button>
    <button class="secondary" onclick={toggleImport}>
      {importOpen ? '收起导入' : '导入题面'}
    </button>
    <label class="file">
      <input type="file" accept="application/json,.json" onchange={onFile} />
      选择文件预览
    </label>
  </div>
  {#if importOpen}
    <textarea bind:value={importText} rows="7" placeholder="粘贴题面 JSON：先做结构校验并显示差异，确认后才替换当前草稿"></textarea>
    <div class="row">
      <button class="primary" onclick={previewImport}>解析并预览差异</button>
      {#if preview}
        <button class="confirm" onclick={confirmImport} disabled={confirming || !preview.diff.hasChanges}>
          {confirming ? '保存中…' : '确认替换并自动保存'}
        </button>
        <button class="cancel" onclick={cancelImport}>取消（草稿不变）</button>
      {/if}
    </div>
  {/if}

  {#if preview}
    {@const d = preview.diff}
    <div class="diff" role="status" aria-label="导入差异预览">
      <div class="legend">
        <span><i class="added"></i>新增</span>
        <span><i class="removed"></i>删除</span>
        <span><i class="modified"></i>修改</span>
      </div>
      <p class="summary">
        提示 {d.givens.length} 处；宫区归属 {d.regions.length} 格；温度计 {d.thermometers.length} 支。
        确认后旧“唯一解”等结论将变为未检查。
      </p>
      {#if d.givens.length > 0}
        <section>
          <h5>提示数字</h5>
          <ul>
            {#each d.givens as item (item.cell)}
              <li class={item.type}>{givenText(item)}</li>
            {/each}
          </ul>
        </section>
      {/if}
      {#if d.regions.length > 0}
        <section>
          <h5>宫区归属</h5>
          <p>{d.regions.map((x) => `${coordLabel(x.cell)}：宫 ${x.before + 1} → 宫 ${x.after + 1}`).join('；')}</p>
        </section>
      {/if}
      {#if d.thermometers.length > 0}
        <section>
          <h5>温度计</h5>
          <ul>
            {#each d.thermometers as item, i (i)}
              <li class={item.type}>
                {item.type === 'added' ? '新增' : item.type === 'removed' ? '删除' : '修改'}
                温度计：{item.type === 'removed'
                  ? item.beforePath.map(coordLabel).join(' → ')
                  : item.afterPath.map(coordLabel).join(' → ')}
                {#if item.type === 'modified'}
                  <span>（旧：{item.beforePath.map(coordLabel).join(' → ')}）</span>
                {/if}
              </li>
            {/each}
          </ul>
        </section>
      {/if}
      {#if !d.hasChanges}<p class="ok">无差异。</p>{/if}
    </div>
  {/if}

  {#if message}<p class="msg {messageKind}">{message}</p>{/if}
  <p class="note">
    导入与导出都只识别宫区、提示、温度计三件套；文件中的答案、历史检查、首解或私有批注
    <strong>不会覆盖</strong>本地状态。
  </p>
</div>

<style>
  .panel { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; }
  h4 { margin: 0 0 8px; font-size: 13px; }
  .row { display: flex; flex-wrap: wrap; gap: 6px; }
  button { border: 1px solid #d1d5db; background: #fff; border-radius: 6px; padding: 6px 10px; cursor: pointer; font-size: 13px; }
  .primary { background: #2563eb; color: #fff; border-color: #2563eb; }
  .confirm { background: #16a34a; color: #fff; border-color: #16a34a; }
  .cancel { background: #fff; color: #b91c1c; border-color: #fecaca; }
  .secondary { background: #f3f4f6; }
  .file { position: relative; overflow: hidden; border: 1px solid #d1d5db; border-radius: 6px; padding: 6px 10px; font-size: 13px; cursor: pointer; background: #fff; }
  .file input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
  textarea { width: 100%; box-sizing: border-box; margin-top: 8px; font-family: ui-monospace, monospace; font-size: 12px; border: 1px solid #d1d5db; border-radius: 6px; padding: 8px; }
  .msg { font-size: 12px; color: #2563eb; margin: 8px 0 0; }
  .msg.error { color: #b91c1c; }
  .note { font-size: 11px; color: #6b7280; margin: 8px 0 0; line-height: 1.5; }
  .diff { margin-top: 10px; border: 1px solid #d1d5db; border-radius: 6px; padding: 8px; background: #fff; max-height: 260px; overflow: auto; font-size: 12px; }
  .legend { display: flex; gap: 10px; font-size: 11px; color: #4b5563; }
  .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 3px; }
  .added { background: rgba(22,163,74,.25); }
  .removed { background: rgba(220,38,38,.22); }
  .modified { background: rgba(217,119,6,.25); }
  .summary { margin: 6px 0; color: #374151; }
  section { margin-top: 6px; }
  h5 { margin: 6px 0 3px; font-size: 12px; }
  ul { margin: 0; padding-left: 16px; }
  li.added, .ok { color: #166534; }
  li.removed { color: #b91c1c; }
  li.modified { color: #b45309; }
  p { margin: 4px 0; line-height: 1.5; }
</style>
